exports.handler = async () => {
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    },
    body: JSON.stringify({
      message: "Deployment successful",
      environment: process.env.ENVIRONMENT_NAME
    })
  };
};
