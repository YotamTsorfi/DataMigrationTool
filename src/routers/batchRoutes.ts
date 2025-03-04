import express from 'express';
import { BatchService } from '../services/batchService';
import { priorityAuthMiddleware } from '../middleware/priorityAuth';

const router = express.Router();

router.use(priorityAuthMiddleware);

router.post('/process', async (req, res) => {
    try {
        await BatchService.processBatchVehicles(req, res);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

router.post("/process-files", async (req, res) => {
  try {
    await BatchService.processBatchVehiclesFiles(req, res);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

router.post("/process-batches", async (req, res) => {
  try {
    const results = await BatchService.processBatches();
    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;