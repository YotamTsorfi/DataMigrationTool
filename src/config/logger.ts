import fs from "fs";
import path from "path";

// Determine the root directory of your application
const rootDir: string = path.resolve(__dirname, "../"); // Go up one level from the current directory

// Create logs directory if it doesn't exist in the root directory
const logsDir: string = path.join(rootDir, "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Function to write logs to a file
const writeToLogFile = (fileName: string, logData: string): void => {
  const logFilePath: string = path.join(logsDir, fileName);
  const now = new Date();
  const formattedDate = `${now.getDate().toString().padStart(2, "0")}/${(now.getMonth() + 1).toString().padStart(2, "0")}/${now.getFullYear()} - ${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
  const logMessage = `${formattedDate} - ${logData}\n`;

  fs.appendFile(logFilePath, logMessage, (err) => {
    if (err) throw err;
    // console.log(`Logged to ${fileName}: ${logData}`);
  });
};

export { writeToLogFile };
