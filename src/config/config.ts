const requiredEnvVars = [
  "SERVER_PORT",
  "PRIORITY_BASE_URL",
  "PRIORITY_PAT",
  "PRIORITY_PASSWORD",
  "CARMELTON_DB_USER",
  "CARMELTON_DB_PASSWORD",
  "CARMELTON_DB_SERVER",
  "CARMELTON_DB_NAME",
  "CARMELTON_DB_PORT",
];

requiredEnvVars.forEach((envVar) => {
  if (!process.env[envVar]) {
    throw new Error(
      `❌ ${envVar} is not defined in the environment variables.`
    );
  }
});

console.log("✅ All required environment variables are set");
console.log(`🌐 Using server port: ${process.env.SERVER_PORT}`);

export const config = {
  priorityDEVBaseUrl: process.env.PRIORITY_BASE_URL!,
  priorityPAT: process.env.PRIORITY_PAT!,
  priorityPassword: process.env.PRIORITY_PASSWORD!,

  db: {
    user: process.env.CARMELTON_DB_USER!,
    password: process.env.CARMELTON_DB_PASSWORD!,
    server: process.env.CARMELTON_DB_SERVER!,
    port: parseInt(process.env.CARMELTON_DB_PORT!, 10),
    database: process.env.CARMELTON_DB_NAME!,
    options: {
      encrypt: true,
      trustServerCertificate: true,
    },
  },

  port: parseInt(process.env.SERVER_PORT || "3007", 10),
};
