module.exports = {
  apps: [
    {
      name: "carmelton-server",
      script: "./dist/index.js",
      env: {
        NODE_ENV: "production",
        SERVER_PORT: 3001,
        // הוסף כאן משתני סביבה נוספים שנדרשים לך
      },
      // הגדרות נוספות
      instances: 1,
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "1G",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
