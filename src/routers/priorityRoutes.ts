//priorityRoutes.ts

import express from 'express';
import { vehiclesController } from "../controllers/vehiclesController";
import { priorityAuthMiddleware } from "../middleware/priorityAuth";

const router = express.Router();

// החלת Middleware על כל נתיבי Priority
router.use(priorityAuthMiddleware);
// ----------------------------------------------------

router.get('/vehicles', vehiclesController.getAllVehicles);
router.get('/vehicles/:id', vehiclesController.getVehicleById);
router.post('/vehicles', vehiclesController.createVehicle);
router.put('/vehicles/:id', vehiclesController.updateVehicle);
router.delete('/vehicles/:id', vehiclesController.deleteVehicle);

export default router;