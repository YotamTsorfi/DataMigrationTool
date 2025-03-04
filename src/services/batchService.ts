//batchService.ts

import path from "path";
import fs from "fs";
import axios from "axios";
import { writeToLogFile } from "../config/logger";
import { performBatchCreateVehicles } from "../controllers/vehiclesController";
import { Request, Response } from "express";
import { Scheduler } from "../utils/scheduler";
import { handleError } from "../utils/errorHandler";
import { processBatch, processBatches } from "../jobs/job";

export class BatchService {
  static async processBatchVehicles(req: Request, res: Response) {
    const result = await processBatch(req.body.filePath);
    res.status(result.success ? 200 : 500).json(result);
  }

  static async processBatchVehiclesFiles(req: Request, res: Response) {
    const results = await processBatches();
    res.status(200).json(results);
  }

  static async processBatches() {
    const results = await processBatches();
    return results;
  }
}
