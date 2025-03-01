//priorityRoutes.ts

import express from 'express';
import {
  vehiclesController,
  performBatchCreateVehicles,
} from "../controllers/vehiclesController";
import { priorityAuthMiddleware } from "../middleware/priorityAuth";

const router = express.Router();

// החלת Middleware על כל נתיבי Priority
router.use(priorityAuthMiddleware);

router.post("/vehicles/batch", async (req, res) => {
  const result = await performBatchCreateVehicles(req);
  if (result.success) {
    res.status(200).json(result);
  } else {
    res.status(500).json(result);
  }
});
router.get('/vehicles', vehiclesController.getAllVehicles);
router.get('/vehicles/:id', vehiclesController.getVehicleById);
router.post('/vehicles', vehiclesController.createVehicle);
router.put('/vehicles/:id', vehiclesController.updateVehicle);
router.delete('/vehicles/:id', vehiclesController.deleteVehicle);

export default router;