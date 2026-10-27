# Multi-environment deployment

Deploy the **same serverless application** to separate **development** and **production** environments using AWS SAM/CloudFormation and GitHub Actions with OIDC (no long-lived AWS access keys).

**Idea:** shared application code; separate infrastructure, configuration, IAM roles, and deployment controls.

![Both stacks CREATE_COMPLETE](multi-environment-deployment/test/public/final_2_stacks.png)

---

## Architecture

```text
                    GitHub (branch: beta)
                           │
           ┌───────────────┴───────────────┐
           ▼                               ▼
   deploy-dev.yml                   deploy-prod.yml
   environment: development         environment: production
           │                               │
           ▼                               ▼
   AssumeRole (OIDC)                AssumeRole (OIDC)
   role/dev                         role/prod
           │                               │
           ▼                               ▼
   Stack: multi-env-dev             Stack: multi-env-prod
   Lambda + HTTP API                Lambda + HTTP API
   ENVIRONMENT_NAME=dev             ENVIRONMENT_NAME=prod
```

| Piece | Role |
|--------|------|
| `src/app.js` | Shared Lambda handler; returns `ENVIRONMENT_NAME` |
| `template.yaml` | One SAM template; parameter `EnvironmentName` = `dev` \| `prod` |
| `tests/app.test.js` | Unit test (`node --test`) |
| `.github/workflows/deploy-dev.yml` | Auto-deploy to development |
| `.github/workflows/deploy-prod.yml` | Deploy to production (GitHub environment gate) |

---

## Project layout

App lives in `multi-environment-deployment/`:

```text
multi-environment-deployment/
├── template.yaml
├── src/
│   └── app.js
├── tests/
│   └── app.test.js
├── test/
│   └── public/          # evidence screenshots
├── package.json
├── .gitignore
└── .github/
    └── workflows/
        ├── deploy-dev.yml
        └── deploy-prod.yml
```

---

## Prerequisites

- Node.js 22+
- AWS CLI + SAM CLI
- GitHub repo: [salim359/multi-environment-deployment](https://github.com/salim359/multi-environment-deployment)
- AWS account with IAM permission to manage OIDC provider and roles

---

## Step 1 — Application & template

`src/app.js` returns which environment served the request:

```js
exports.handler = async () => ({
  statusCode: 200,
  headers: {
    "content-type": "application/json",
    "cache-control": "no-store"
  },
  body: JSON.stringify({
    message: "Deployment successful",
    environment: process.env.ENVIRONMENT_NAME
  })
});
```

`template.yaml` creates one HTTP API + Lambda per stack. Stack differences come from the `EnvironmentName` parameter (function name, API stage, env var).

Local checks:

```bash
cd multi-environment-deployment
npm test
sam validate --lint
```

---

## Step 2 — GitHub repository

1. Create repo `multi-environment-deployment`.
2. Commit and push branch **`beta`** (workflows trigger on `beta`).
3. If HTTPS push hangs waiting for credentials, switch to SSH:

```bash
git remote set-url origin git@github.com:salim359/multi-environment-deployment.git
# or a configured SSH host alias, e.g. git@github-personal:...
git push -u origin beta
```

---

## Step 3 — GitHub Environments & variables

### Environments

**Settings → Environments** — create:

- `development`
- `production` (optional: add **required reviewers**)

### Environment variables

On each environment, add variable **`AWS_ROLE_ARN`** (Variables, not Secrets):

| Environment | `AWS_ROLE_ARN` |
|-------------|----------------|
| `development` | `arn:aws:iam::399352912234:role/dev` |
| `production` | `arn:aws:iam::399352912234:role/prod` |

### Repository variable

**Settings → Secrets and variables → Actions → Variables:**

| Name | Value |
|------|--------|
| `AWS_REGION` | `us-east-1` |

Deploy jobs **must** set `environment: development` or `environment: production`, or environment-scoped `vars.AWS_ROLE_ARN` will be empty.

---

## Step 4 — AWS OIDC (one-time)

### 4.1 OIDC identity provider

- URL: `token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`

![Create GitHub OIDC identity provider](multi-environment-deployment/test/public/make_identity_provider.png)

### 4.2 IAM roles `dev` and `prod`

Trust policy must match the **actual** GitHub OIDC `sub` claim. This account uses the numeric-ID form (check CloudTrail if unsure):

**`dev` role — trust `sub`:**

```text
repo:salim359@212309625/multi-environment-deployment@1435319184:environment:development
```

![Dev role trust policy](multi-environment-deployment/test/public/dev_role_trust_policy.png)

**`prod` role — trust `sub`:**

```text
repo:salim359@212309625/multi-environment-deployment@1435319184:environment:production
```

![Prod role trust policy](multi-environment-deployment/test/public/prod_role_trust_policy.png)

Also require:

```text
token.actions.githubusercontent.com:aud = sts.amazonaws.com
```

> Do **not** use only `repo:salim359/multi-environment-deployment:*` here — tokens from this repo include `@ownerId` / `@repoId` and will be denied.

### 4.3 Role permissions

Both roles need identity policies for SAM deploy (CloudFormation, S3 artifacts, IAM PassRole/CreateRole, Lambda, API Gateway, CloudWatch Logs). Empty roles fail with `cloudformation:CreateChangeSet` AccessDenied.

![SamDeployPermissions on the dev role](multi-environment-deployment/test/public/attached_permissions.png)

---

## Step 5 — How the pipelines work

On push to `beta` (or manual **workflow_dispatch**):

1. **Test** — `npm test`
2. **Deploy** — select GitHub environment → load `AWS_ROLE_ARN` + `AWS_REGION`
3. **OIDC** — `aws-actions/configure-aws-credentials` assumes the env role
4. **SAM** — `sam build` then `sam deploy`:
   - Dev → stack `multi-env-dev`, `EnvironmentName=dev`
   - Prod → stack `multi-env-prod`, `EnvironmentName=prod`

---

## Step 6 — Deploy & verify

1. Push to `beta` or run the workflow from the Actions tab.
2. Open the workflow run; confirm Configure AWS credentials and SAM deploy succeed.

**Development workflow:**

![Deploy Development workflow success](multi-environment-deployment/test/public/deployment_dev.png)

**Production workflow:**

![Deploy Production workflow success](multi-environment-deployment/test/public/deployment_prod.png)

3. Read stack outputs:

```bash
aws cloudformation describe-stacks --stack-name multi-env-dev \
  --query 'Stacks[0].Outputs' --output table

aws cloudformation describe-stacks --stack-name multi-env-prod \
  --query 'Stacks[0].Outputs' --output table
```

Both stacks after a successful run:

![multi-env-dev and multi-env-prod CREATE_COMPLETE](multi-environment-deployment/test/public/final_2_stacks.png)

4. Call the API:

```bash
curl "<ApiUrl>"
```

Dev:

```json
{ "message": "Deployment successful", "environment": "dev" }
```

Prod:

```json
{ "message": "Deployment successful", "environment": "prod" }
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|--------|-----|
| `git push` hangs on HTTPS | Waiting for username/password | Use SSH remote or a PAT |
| Credentials could not be loaded / empty `AWS_ROLE_ARN` | Missing env var or job missing `environment:` | Add env variable; set `environment: development` / `production` |
| `Not authorized to perform sts:AssumeRoleWithWebIdentity` | Trust `sub` does not match token | Align trust with CloudTrail `userName` (numeric-ID form) |
| `CreateChangeSet` AccessDenied | Role has no permissions | Attach SAM deploy policy to the role |
| Wrong environment in JSON | Hit the other stack’s URL | Compare `ApiUrl` outputs for `multi-env-dev` vs `multi-env-prod` |

---

## Cleanup

```bash
aws cloudformation delete-stack --stack-name multi-env-dev
aws cloudformation delete-stack --stack-name multi-env-prod
```

---

## Takeaway

- **One codebase**, one SAM template.
- **Two stacks**, two configs (`ENVIRONMENT_NAME`), two IAM roles.
- **Two GitHub environments** for isolation and optional prod approval.
- **OIDC only** — temporary credentials, no AWS keys in GitHub secrets.
