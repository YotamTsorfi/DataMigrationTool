import * as fs from "fs";
import path from "path";
import dotenv from "dotenv";

export default function loadEnvironmentVariables(): void {
  const isProduction = process.env.NODE_ENV === "production";
  console.log(
    `🌍 Running in ${isProduction ? "PRODUCTION" : "DEVELOPMENT"} mode`,
  );

  const envFileName = isProduction ? ".env.production" : ".env.development";
  const possiblePaths = [
    path.resolve(__dirname, "../../", envFileName),
    path.resolve(process.cwd(), envFileName),
  ];

  for (const filePath of possiblePaths) {
    if (fs.existsSync(filePath)) {
      console.log(`🔐 Loading environment variables from: ${filePath}`);
      dotenv.config({ path: filePath });
      return;
    }
  }

  console.warn(
    "⚠️ No .env file was loaded! Environment variables may be missing.",
  );
}
