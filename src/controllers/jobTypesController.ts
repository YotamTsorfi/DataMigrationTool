import { Request, Response } from "express";
import { DatabaseService } from "../services/databaseService";

/**
 * Controller for managing PriorityJobTypes and PriorityChildJob tables
 */
class JobTypesController {
  /**
   * Get all job types
   */
  public async getAllJobTypes(req: Request, res: Response): Promise<void> {
    try {
      const jobTypes = await DatabaseService.executeQuery(`
        SELECT 
          JobTypeId, JobTypeName, DBTableName, ScreenName, 
          SourceSystem, priority_id, linkedField, RunOrder, isReady, hasDependency
        FROM PriorityJobTypes
        ORDER BY RunOrder ASC
      `);

      res.json(jobTypes);
    } catch (error) {
      console.error("Error fetching job types:", error);
      res.status(500).json({ error: "Failed to fetch job types" });
    }
  }

  /**
   * Get a single job type by ID
   */
  public async getJobTypeById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const jobType = await DatabaseService.executeQuery(
        `
        SELECT 
          JobTypeId, JobTypeName, DBTableName, ScreenName, 
          SourceSystem, priority_id, linkedField, RunOrder, isReady, hasDependency
        FROM PriorityJobTypes
        WHERE JobTypeId = @id
      `,
        { id }
      );

      if (!jobType || jobType.length === 0) {
        res.status(404).json({ error: "Job type not found" });
        return;
      }

      res.json(jobType[0]);
    } catch (error) {
      console.error("Error fetching job type:", error);
      res.status(500).json({ error: "Failed to fetch job type" });
    }
  }

  /**
   * Create a new job type
   */
  public async createJobType(req: Request, res: Response): Promise<void> {
    try {
      const {
        JobTypeName,
        DBTableName,
        ScreenName,
        SourceSystem,
        priority_id,
        linkedField,
        RunOrder,
        hasDependency,
      } = req.body;

      // Validate required fields
      if (!JobTypeName || !DBTableName || !ScreenName) {
        res.status(400).json({
          error: "JobTypeName, DBTableName, and ScreenName are required",
        });
        return;
      }

      const result = await DatabaseService.executeQuery(
        `
        INSERT INTO PriorityJobTypes (JobTypeName, DBTableName, ScreenName, SourceSystem, priority_id, linkedField, RunOrder, hasDependency)
        OUTPUT INSERTED.JobTypeId, INSERTED.JobTypeName, INSERTED.DBTableName, INSERTED.ScreenName, 
            INSERTED.SourceSystem, INSERTED.priority_id, INSERTED.linkedField, INSERTED.RunOrder,
            INSERTED.isReady, INSERTED.hasDependency
        VALUES (@JobTypeName, @DBTableName, @ScreenName, @SourceSystem, @priority_id, @linkedField, @RunOrder, @hasDependency)
      `,
        {
          JobTypeName,
          DBTableName,
          ScreenName,
          SourceSystem: SourceSystem || null,
          priority_id: priority_id || null,
          linkedField: linkedField || null,
          RunOrder: RunOrder || 0,
          hasDependency: hasDependency !== undefined ? hasDependency : false,
        }
      );

      res.status(201).json(result[0]);
    } catch (error) {
      console.error("Error creating job type:", error);
      res.status(500).json({ error: "Failed to create job type" });
    }
  }

  /**
   * Update an existing job type
   */
  public async updateJobType(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const {
        JobTypeName,
        DBTableName,
        ScreenName,
        SourceSystem,
        priority_id,
        linkedField,
        RunOrder,
        hasDependency,
      } = req.body;

      // Validate required fields
      if (!JobTypeName || !DBTableName || !ScreenName) {
        res.status(400).json({
          error: "JobTypeName, DBTableName, and ScreenName are required",
        });
        return;
      }

      // Check if job type exists
      const existingJobType = await DatabaseService.executeQuery(
        `
        SELECT JobTypeId FROM PriorityJobTypes WHERE JobTypeId = @id
      `,
        { id }
      );

      if (!existingJobType || existingJobType.length === 0) {
        res.status(404).json({ error: "Job type not found" });
        return;
      }

      const result = await DatabaseService.executeQuery(
        `
        UPDATE PriorityJobTypes
        SET 
          JobTypeName = @JobTypeName,
          DBTableName = @DBTableName,
          ScreenName = @ScreenName,
          SourceSystem = @SourceSystem,
          priority_id = @priority_id,
          linkedField = @linkedField,
          RunOrder = @RunOrder,
          hasDependency = @hasDependency
        OUTPUT INSERTED.JobTypeId, INSERTED.JobTypeName, INSERTED.DBTableName, INSERTED.ScreenName, 
              INSERTED.SourceSystem, INSERTED.priority_id, INSERTED.linkedField, INSERTED.RunOrder,
              INSERTED.isReady, INSERTED.hasDependency
        WHERE JobTypeId = @id
      `,
        {
          id,
          JobTypeName,
          DBTableName,
          ScreenName,
          SourceSystem: SourceSystem || null,
          priority_id: priority_id || null,
          linkedField: linkedField || null,
          RunOrder: RunOrder || 0,
          hasDependency: hasDependency !== undefined ? hasDependency : false,
        }
      );

      res.json(result[0]);
    } catch (error) {
      console.error("Error updating job type:", error);
      res.status(500).json({ error: "Failed to update job type" });
    }
  }

  /**
   * Delete a job type and its associated child jobs
   */
  public async deleteJobType(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      // Check if job type exists
      const existingJobType = await DatabaseService.executeQuery(
        `
        SELECT JobTypeId FROM PriorityJobTypes WHERE JobTypeId = @id
      `,
        { id }
      );

      if (!existingJobType || existingJobType.length === 0) {
        res.status(404).json({ error: "Job type not found" });
        return;
      }

      // Delete associated child jobs first (due to foreign key constraint)
      await DatabaseService.executeQuery(
        `
        DELETE FROM PriorityChildJob WHERE refParentJobId = @id
      `,
        { id }
      );

      // Now delete the job type
      await DatabaseService.executeQuery(
        `
        DELETE FROM PriorityJobTypes WHERE JobTypeId = @id
      `,
        { id }
      );

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting job type:", error);
      res.status(500).json({ error: "Failed to delete job type" });
    }
  }

  /**
   * Get child jobs for a specific parent job type
   */
  public async getChildJobsByParentId(
    req: Request,
    res: Response
  ): Promise<void> {
    try {
      const { parentId } = req.params;

      // Check if parent job type exists
      const existingJobType = await DatabaseService.executeQuery(
        `
        SELECT JobTypeId FROM PriorityJobTypes WHERE JobTypeId = @parentId
      `,
        { parentId }
      );

      if (!existingJobType || existingJobType.length === 0) {
        res.status(404).json({ error: "Parent job type not found" });
        return;
      }

      const childJobs = await DatabaseService.executeQuery(
        `
        SELECT 
          ChildJobeId, JobTypeName, DBTableName, ScreenName, 
          SourceSystem, priority_id, refParentJobId, HasSiblings, isReady
        FROM PriorityChildJob
        WHERE refParentJobId = @parentId
      `,
        { parentId }
      );

      res.json(childJobs);
    } catch (error) {
      console.error("Error fetching child jobs:", error);
      res.status(500).json({ error: "Failed to fetch child jobs" });
    }
  }

  /**
   * Create a new child job
   */
  public async createChildJob(req: Request, res: Response): Promise<void> {
    try {
      const {
        JobTypeName,
        DBTableName,
        ScreenName,
        SourceSystem,
        priority_id,
        refParentJobId,
        HasSiblings,
      } = req.body;

      // Validate required fields
      if (!JobTypeName || !DBTableName || !ScreenName || !refParentJobId) {
        res.status(400).json({
          error:
            "JobTypeName, DBTableName, ScreenName, and refParentJobId are required",
        });
        return;
      }

      // Check if parent job type exists
      const existingJobType = await DatabaseService.executeQuery(
        `
        SELECT JobTypeId FROM PriorityJobTypes WHERE JobTypeId = @refParentJobId
      `,
        { refParentJobId }
      );

      if (!existingJobType || existingJobType.length === 0) {
        res.status(404).json({ error: "Parent job type not found" });
        return;
      }

      const result = await DatabaseService.executeQuery(
        `
        INSERT INTO PriorityChildJob (JobTypeName, DBTableName, ScreenName, SourceSystem, priority_id, refParentJobId, HasSiblings)
        OUTPUT INSERTED.ChildJobeId, INSERTED.JobTypeName, INSERTED.DBTableName, INSERTED.ScreenName, 
               INSERTED.SourceSystem, INSERTED.priority_id, INSERTED.refParentJobId, INSERTED.HasSiblings
        VALUES (@JobTypeName, @DBTableName, @ScreenName, @SourceSystem, @priority_id, @refParentJobId, @HasSiblings)
      `,
        {
          JobTypeName,
          DBTableName,
          ScreenName,
          SourceSystem: SourceSystem || null,
          priority_id: priority_id || null,
          refParentJobId,
          HasSiblings: HasSiblings !== undefined ? HasSiblings : false,
        }
      );

      res.status(201).json(result[0]);
    } catch (error) {
      console.error("Error creating child job:", error);
      res.status(500).json({ error: "Failed to create child job" });
    }
  }

  /**
   * Update an existing child job
   */
  public async updateChildJob(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const {
        JobTypeName,
        DBTableName,
        ScreenName,
        SourceSystem,
        priority_id,
        refParentJobId,
        HasSiblings,
      } = req.body;

      // Validate required fields
      if (!JobTypeName || !DBTableName || !ScreenName || !refParentJobId) {
        res.status(400).json({
          error:
            "JobTypeName, DBTableName, ScreenName, and refParentJobId are required",
        });
        return;
      }

      // Check if child job exists
      const existingChildJob = await DatabaseService.executeQuery(
        `
        SELECT ChildJobeId FROM PriorityChildJob WHERE ChildJobeId = @id
      `,
        { id }
      );

      if (!existingChildJob || existingChildJob.length === 0) {
        res.status(404).json({ error: "Child job not found" });
        return;
      }

      // Check if parent job type exists
      const existingJobType = await DatabaseService.executeQuery(
        `
        SELECT JobTypeId FROM PriorityJobTypes WHERE JobTypeId = @refParentJobId
      `,
        { refParentJobId }
      );

      if (!existingJobType || existingJobType.length === 0) {
        res.status(404).json({ error: "Parent job type not found" });
        return;
      }

      const result = await DatabaseService.executeQuery(
        `
        UPDATE PriorityChildJob
        SET 
          JobTypeName = @JobTypeName,
          DBTableName = @DBTableName,
          ScreenName = @ScreenName,
          SourceSystem = @SourceSystem,
          priority_id = @priority_id,
          refParentJobId = @refParentJobId,
          HasSiblings = @HasSiblings
        OUTPUT INSERTED.ChildJobeId, INSERTED.JobTypeName, INSERTED.DBTableName, INSERTED.ScreenName, 
               INSERTED.SourceSystem, INSERTED.priority_id, INSERTED.refParentJobId, INSERTED.HasSiblings
        WHERE ChildJobeId = @id
      `,
        {
          id,
          JobTypeName,
          DBTableName,
          ScreenName,
          SourceSystem: SourceSystem || null,
          priority_id: priority_id || null,
          refParentJobId,
          HasSiblings,
        }
      );

      res.json(result[0]);
    } catch (error) {
      console.error("Error updating child job:", error);
      res.status(500).json({ error: "Failed to update child job" });
    }
  }

  /**
   * Delete a child job
   */
  public async deleteChildJob(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      // Check if child job exists
      const existingChildJob = await DatabaseService.executeQuery(
        `
        SELECT ChildJobeId FROM PriorityChildJob WHERE ChildJobeId = @id
      `,
        { id }
      );

      if (!existingChildJob || existingChildJob.length === 0) {
        res.status(404).json({ error: "Child job not found" });
        return;
      }

      await DatabaseService.executeQuery(
        `
        DELETE FROM PriorityChildJob WHERE ChildJobeId = @id
      `,
        { id }
      );

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting child job:", error);
      res.status(500).json({ error: "Failed to delete child job" });
    }
  }
}

export default new JobTypesController();
