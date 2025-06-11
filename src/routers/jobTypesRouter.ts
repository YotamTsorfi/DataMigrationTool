import { Router } from "express";
import jobTypesController from "../controllers/jobTypesController";

const router = Router();

// Job Types routes
router.get("/jobtypes", jobTypesController.getAllJobTypes);
router.get("/jobtypes/:id", jobTypesController.getJobTypeById);
router.post("/jobtypes", jobTypesController.createJobType);
router.put("/jobtypes/:id", jobTypesController.updateJobType);
router.delete("/jobtypes/:id", jobTypesController.deleteJobType);

// Child Jobs routes
router.get(
  "/jobtypes/:parentId/childjobs",
  jobTypesController.getChildJobsByParentId
);
router.post("/childjobs", jobTypesController.createChildJob);
router.put("/childjobs/:id", jobTypesController.updateChildJob);
router.delete("/childjobs/:id", jobTypesController.deleteChildJob);

export default router;
