import {
  IJobType,
  IChildJob,
} from "../components/JobTypesManager/JobTypesManager";

const API_URL = process.env.REACT_APP_API_URL || "";

/**
 * Fetches all job types from the API
 * @returns Promise with array of job types
 */
export const fetchJobTypes = async (): Promise<IJobType[]> => {
  const response = await fetch(`${API_URL}/api/jobtypes`);

  if (!response.ok) {
    throw new Error("Failed to fetch job types");
  }

  return await response.json();
};

/**
 * Creates a new job type
 * @param jobType The job type to create
 * @returns Promise with the created job type
 */
export const createJobType = async (jobType: IJobType): Promise<IJobType> => {
  const response = await fetch(`${API_URL}/api/jobtypes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(jobType),
  });

  if (!response.ok) {
    throw new Error("Failed to create job type");
  }

  return await response.json();
};

/**
 * Updates an existing job type
 * @param jobType The job type to update
 * @returns Promise with the updated job type
 */
export const updateJobType = async (jobType: IJobType): Promise<IJobType> => {
  const response = await fetch(`${API_URL}/api/jobtypes/${jobType.JobTypeId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(jobType),
  });

  if (!response.ok) {
    throw new Error("Failed to update job type");
  }

  return await response.json();
};

/**
 * Deletes a job type by ID
 * @param jobTypeId The ID of the job type to delete
 */
export const deleteJobType = async (jobTypeId: number): Promise<void> => {
  const response = await fetch(`${API_URL}/api/jobtypes/${jobTypeId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("Failed to delete job type");
  }
};

/**
 * Fetches child jobs for a specific parent job type
 * @param parentJobTypeId The parent job type ID
 * @returns Promise with array of child jobs
 */
export const fetchChildJobs = async (
  parentJobTypeId: number
): Promise<IChildJob[]> => {
  const response = await fetch(
    `${API_URL}/api/jobtypes/${parentJobTypeId}/childjobs`
  );

  if (!response.ok) {
    throw new Error("Failed to fetch child jobs");
  }

  return await response.json();
};

/**
 * Creates a new child job
 * @param childJob The child job to create
 * @returns Promise with the created child job
 */
export const createChildJob = async (
  childJob: IChildJob
): Promise<IChildJob> => {
  const response = await fetch(`${API_URL}/api/childjobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(childJob),
  });

  if (!response.ok) {
    throw new Error("Failed to create child job");
  }

  return await response.json();
};

/**
 * Updates an existing child job
 * @param childJob The child job to update
 * @returns Promise with the updated child job
 */
export const updateChildJob = async (
  childJob: IChildJob
): Promise<IChildJob> => {
  const response = await fetch(
    `${API_URL}/api/childjobs/${childJob.ChildJobeId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(childJob),
    }
  );

  if (!response.ok) {
    throw new Error("Failed to update child job");
  }

  return await response.json();
};

/**
 * Deletes a child job by ID
 * @param childJobId The ID of the child job to delete
 */
export const deleteChildJob = async (childJobId: number): Promise<void> => {
  const response = await fetch(`${API_URL}/api/childjobs/${childJobId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("Failed to delete child job");
  }
};
