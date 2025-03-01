//batchService.ts

import path from "path";
import fs from "fs";
import axios from "axios";
import { writeToLogFile } from "../config/logger";
import { vehiclesController } from "../controllers/vehiclesController";
import { performBatchCreateVehicles } from "../controllers/vehiclesController";
import { Request, Response } from "express";

export class BatchService {
  //------------------------------------------------------------
  static async processBatchVehiclesFiles(req: Request, res: Response) {
    try {
      console.log("Starting batch vehicles processing...");
      writeToLogFile(
        "general.log",
        "[INFO] Starting batch vehicles processing..."
      );

      const dataDir = path.join(__dirname, "../data");
      const files = fs
        .readdirSync(dataDir)
        .filter((file) => file.startsWith("vehicles_batch_"));

      for (const file of files) {
        const vehiclesPath = path.join(dataDir, file);
        console.log("Reading vehicles from:", vehiclesPath);

        if (!fs.existsSync(vehiclesPath)) {
          throw new Error(`Vehicles file not found at: ${vehiclesPath}`);
        }

        const vehiclesData = fs.readFileSync(vehiclesPath, "utf-8");
        let vehicles;

        try {
          vehicles = JSON.parse(vehiclesData);
          console.log(
            `Successfully loaded ${vehicles.length} vehicles from file`
          );
        } catch (error) {
          const parseError =
            error instanceof Error ? error : new Error("Unknown parsing error");
          throw new Error(
            `Failed to parse vehicles JSON: ${parseError.message}`
          );
        }

        if (!Array.isArray(vehicles)) {
          throw new Error("Vehicles data must be an array");
        }

        const batchSize = 100; // Define the batch size to 100 to avoid exceeding the limit
        for (let i = 0; i < vehicles.length; i += batchSize) {
          const batch = vehicles.slice(i, i + batchSize);
          const requestData = {
            body: { vehicles: batch },
            priorityBatchAxios: req.priorityBatchAxios,
          };

          console.log(`Processing batch with ${batch.length} vehicles...`);

          // Call performBatchCreateVehicles directly
          const result = await performBatchCreateVehicles(requestData as any);

          if (!result.success) {
            throw new Error(result.error);
          }
        }
      }

      writeToLogFile(
        "general.log",
        `[INFO] Batch processing completed successfully`
      );

      res.status(200).json({
        success: true,
        message: "Batch processing completed successfully",
      });
    } catch (error) {
      let errorMessage: string;

      if (axios.isAxiosError(error)) {
        errorMessage = `${error.message} - ${JSON.stringify(error.response?.data)}`;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      } else {
        errorMessage = "An unknown error occurred";
      }

      console.error("Batch Processing Error:", errorMessage);
      writeToLogFile(
        "general.log",
        `[ERROR] Batch processing failed: ${errorMessage}`
      );

      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
  //------------------------------------------------------------
  static async processBatchVehicles(req: Request, res: Response) {
    try {
      console.log("Starting batch vehicles processing...");
      writeToLogFile(
        "general.log",
        "[INFO] Starting batch vehicles processing..."
      );

      const vehiclesPath = path.join(__dirname, "../data/vehicles.json");
      console.log("Reading vehicles from:", vehiclesPath);

      if (!fs.existsSync(vehiclesPath)) {
        throw new Error(`Vehicles file not found at: ${vehiclesPath}`);
      }

      const vehiclesData = fs.readFileSync(vehiclesPath, "utf-8");
      let vehicles;

      try {
        vehicles = JSON.parse(vehiclesData);
        console.log(
          `Successfully loaded ${vehicles.length} vehicles from file`
        );
      } catch (error) {
        const parseError =
          error instanceof Error ? error : new Error("Unknown parsing error");
        throw new Error(`Failed to parse vehicles JSON: ${parseError.message}`);
      }

      if (!Array.isArray(vehicles)) {
        throw new Error("Vehicles data must be an array");
      }

      const requestData = {
        body: { vehicles },
        priorityBatchAxios: req.priorityBatchAxios, // Use the instance from the request
      };

      console.log(
        `Processing batch request with ${vehicles.length} vehicles...`
      );

      // Call performBatchCreateVehicles directly
      const result = await performBatchCreateVehicles(requestData as any);

      if (!result.success) {
        throw new Error(result.error);
      }

      writeToLogFile(
        "general.log",
        `[INFO] Batch processing completed successfully`
      );

      res.status(200).json({
        success: true,
        message: "Batch processing completed successfully",
      });
    } catch (error) {
      let errorMessage: string;

      if (axios.isAxiosError(error)) {
        errorMessage = `${error.message} - ${JSON.stringify(error.response?.data)}`;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      } else {
        errorMessage = "An unknown error occurred";
      }

      console.error("Batch Processing Error:", errorMessage);
      writeToLogFile(
        "general.log",
        `[ERROR] Batch processing failed: ${errorMessage}`
      );

      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
  //------------------------------------------------------------
}
