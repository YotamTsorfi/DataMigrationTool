import { Request, Response } from "express";
import { processBatches } from "../jobs/job";

interface JobRequest {
  recordCount: number;
  startRow: number;
  tableName: string;
  priorityScreenName: string;
}

export const runJobWithInput = async (req: Request, res: Response) => {
    const { recordCount, startRow, tableName, priorityScreenName }: JobRequest = req.body;
  
    try {
      const results = await processBatches(recordCount, startRow, tableName, priorityScreenName);
      res.status(200).json(results);
    } catch (error) {
      console.error("Error running job:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  };