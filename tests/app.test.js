const test = require("node:test");
const assert = require("node:assert/strict");

test("handler returns the configured environment", async () => {
  process.env.ENVIRONMENT_NAME = "dev";

  const { handler } = require("../multi-environment-deployment/src/app");
  const response = await handler();
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.environment, "dev");
  assert.equal(body.message, "Deployment successful");
});
