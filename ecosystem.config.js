module.exports = {
  apps: [
    {
      name: "carmelton-server",
      script: "./dist/index.js",
      cwd: "C:\\production\\carmelton-data-migration",
      env_production: {
        NODE_ENV: "production",
        SERVER_PORT: "3001",
        PRIORITY_BASE_URL:
          "https://fcl.fbc.co.il/odata/Priority/tabula.ini/a120525/",
        PRIORITY_PAT: "2B90288951D04653AFC79CE066C4FC44",
        PRIORITY_PASSWORD: "PAT",
        CARMELTON_DB_USER: "drive",
        CARMELTON_DB_PASSWORD: "Aa123456$",
        CARMELTON_DB_SERVER: "SERVER2019",
        CARMELTON_DB_NAME: "CarmeltonDB_STG",
        CARMELTON_DB_PORT: "1433",
        CARMELTON_DB_SERVER_IP: "localhost",
      },
      instances: 1,
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "1G",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
