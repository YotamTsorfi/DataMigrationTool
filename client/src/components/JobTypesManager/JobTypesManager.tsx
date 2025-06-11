/**
 * Job Types Manager component - provides UI for managing Priority Job Types and Child Jobs
 * Includes toast notifications for all CRUD operations to provide user feedback
 */
import React, { useState, useEffect } from "react";
import { JobTypeForm } from "./JobTypeForm";
import { ChildJobForm } from "./ChildJobForm";
import { JobTypesList } from "./JobTypesList";
import { toast } from "react-toastify";
import {
  fetchJobTypes,
  createJobType,
  updateJobType,
  deleteJobType,
  fetchChildJobs,
  createChildJob,
  updateChildJob,
  deleteChildJob,
} from "../../services/jobTypesService";
import "./JobTypesManager.css";

export interface IJobType {
  JobTypeId?: number;
  JobTypeName: string;
  DBTableName: string;
  ScreenName: string;
  SourceSystem: string | null;
  priority_id: string | null;
  linkedField: string | null;
  RunOrder: number;
}

export interface IChildJob {
  ChildJobeId?: number;
  JobTypeName: string;
  DBTableName: string;
  ScreenName: string;
  SourceSystem: string | null;
  priority_id: string | null;
  refParentJobId: number | null;
  HasSiblings: boolean;
}

const JobTypesManager: React.FC = () => {
  const [jobTypes, setJobTypes] = useState<IJobType[]>([]);
  const [childJobs, setChildJobs] = useState<IChildJob[]>([]);
  const [selectedJobType, setSelectedJobType] = useState<IJobType | null>(null);
  const [isAddingJobType, setIsAddingJobType] = useState<boolean>(false);
  const [isEditingJobType, setIsEditingJobType] = useState<boolean>(false);
  const [isAddingChildJob, setIsAddingChildJob] = useState<boolean>(false);
  const [isEditingChildJob, setIsEditingChildJob] = useState<boolean>(false);
  const [selectedChildJob, setSelectedChildJob] = useState<IChildJob | null>(
    null
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch all job types on mount
  useEffect(() => {
    const loadJobTypes = async () => {
      try {
        const data = await fetchJobTypes();
        setJobTypes(data);
        setLoading(false);
      } catch (err) {
        setError("Failed to load job types");
        toast.error("Failed to load job types");
        setLoading(false);
      }
    };

    loadJobTypes();
  }, []);

  // Fetch child jobs when a job type is selected
  useEffect(() => {
    const loadChildJobs = async () => {
      if (selectedJobType?.JobTypeId) {
        try {
          const data = await fetchChildJobs(selectedJobType.JobTypeId);
          setChildJobs(data);
        } catch (err) {
          setError("Failed to load child jobs");
          toast.error(
            `Failed to load child jobs for ${selectedJobType.JobTypeName}`
          );
        }
      } else {
        setChildJobs([]);
      }
    };

    loadChildJobs();
  }, [selectedJobType]);

  const handleJobTypeSelect = (jobType: IJobType) => {
    setSelectedJobType(jobType);
    setIsAddingJobType(false);
    setIsEditingJobType(false);
    setIsAddingChildJob(false);
    setIsEditingChildJob(false);
    setSelectedChildJob(null);
  };

  const handleAddJobType = async (jobType: IJobType) => {
    try {
      const newJobType = await createJobType(jobType);
      setJobTypes([...jobTypes, newJobType]);
      setIsAddingJobType(false);
      toast.success(
        `New job type "${newJobType.JobTypeName}" created successfully`
      );
    } catch (err) {
      setError("Failed to add job type");
      toast.error("Failed to create job type");
    }
  };

  /**
   * Updates an existing job type and keeps the edit form open for further editing
   */
  const handleEditJobType = async (jobType: IJobType): Promise<void> => {
    try {
      const updatedJobType = await updateJobType(jobType);

      // Update the job types list
      setJobTypes(
        jobTypes.map((jt) =>
          jt.JobTypeId === updatedJobType.JobTypeId ? updatedJobType : jt
        )
      );

      // Update the selected job type with the latest data
      setSelectedJobType(updatedJobType);

      // Show success notification but keep the form open
      toast.success(
        `Job type "${updatedJobType.JobTypeName}" updated successfully`
      );

      // Note: We're no longer closing the form with setIsEditingJobType(false)
    } catch (err) {
      setError("Failed to update job type");
      toast.error("Failed to update job type");
    }
  };

  const handleDeleteJobType = async (jobTypeId: number) => {
    if (
      window.confirm(
        "Are you sure you want to delete this job type? This will also delete all associated child jobs."
      )
    ) {
      try {
        const jobTypeName =
          jobTypes.find((jt) => jt.JobTypeId === jobTypeId)?.JobTypeName || "";
        await deleteJobType(jobTypeId);
        setJobTypes(jobTypes.filter((jt) => jt.JobTypeId !== jobTypeId));
        if (selectedJobType?.JobTypeId === jobTypeId) {
          setSelectedJobType(null);
          setChildJobs([]);
        }
        toast.success(`Job type "${jobTypeName}" deleted successfully`);
      } catch (err) {
        setError("Failed to delete job type");
        toast.error("Failed to delete job type");
      }
    }
  };

  const handleAddChildJob = async (childJob: IChildJob) => {
    try {
      const newChildJob = await createChildJob({
        ...childJob,
        refParentJobId: selectedJobType?.JobTypeId || null,
      });
      setChildJobs([...childJobs, newChildJob]);
      setIsAddingChildJob(false);
      toast.success(
        `New child job "${newChildJob.JobTypeName} - ${newChildJob.DBTableName}" created successfully`
      );
    } catch (err) {
      setError("Failed to add child job");
      toast.error("Failed to add child job");
    }
  };

  const handleEditChildJob = async (childJob: IChildJob) => {
    try {
      const updatedChildJob = await updateChildJob(childJob);
      setChildJobs(
        childJobs.map((cj) =>
          cj.ChildJobeId === updatedChildJob.ChildJobeId ? updatedChildJob : cj
        )
      );
      setIsEditingChildJob(false);
      setSelectedChildJob(null);
      toast.success(
        `Child job "${updatedChildJob.JobTypeName} - ${updatedChildJob.DBTableName}" updated successfully`
      );
    } catch (err) {
      setError("Failed to update child job");
      toast.error("Failed to update child job");
    }
  };

  const handleDeleteChildJob = async (childJobId: number) => {
    if (window.confirm("Are you sure you want to delete this child job?")) {
      try {
        const childJobName =
          childJobs.find((cj) => cj.ChildJobeId === childJobId)?.DBTableName ||
          "";
        await deleteChildJob(childJobId);
        setChildJobs(childJobs.filter((cj) => cj.ChildJobeId !== childJobId));
        if (selectedChildJob?.ChildJobeId === childJobId) {
          setSelectedChildJob(null);
        }
        toast.success(`Child job "${childJobName}" deleted successfully`);
      } catch (err) {
        setError("Failed to delete child job");
        toast.error("Failed to delete child job");
      }
    }
  };

  if (loading) {
    return <div className="loading">Loading job types...</div>;
  }

  return (
    <div className="job-types-manager">
      <h1>Priority Job Types Manager</h1>

      {error && <div className="error-message">{error}</div>}

      <div className="manager-layout">
        <div className="job-types-section">
          <div className="section-header">
            <h2>Job Types</h2>
            <button
              className="add-button"
              onClick={() => {
                setIsAddingJobType(true);
                setSelectedJobType(null);
                setIsEditingJobType(false);
                setIsAddingChildJob(false);
                setIsEditingChildJob(false);
              }}
            >
              Add New Job Type
            </button>
          </div>

          <div className="job-types-list-container">
            <JobTypesList
              jobTypes={jobTypes}
              selectedJobType={selectedJobType}
              onSelect={handleJobTypeSelect}
              onEdit={(jobType) => {
                setSelectedJobType(jobType);
                setIsEditingJobType(true);
                setIsAddingJobType(false);
                setIsAddingChildJob(false);
                setIsEditingChildJob(false);
              }}
              onDelete={(jobTypeId) => handleDeleteJobType(jobTypeId)}
            />
          </div>
        </div>

        <div className="details-section">
          {isAddingJobType && (
            <JobTypeForm
              onSubmit={handleAddJobType}
              onCancel={() => setIsAddingJobType(false)}
            />
          )}

          {isEditingJobType && selectedJobType && (
            <JobTypeForm
              jobType={selectedJobType}
              onSubmit={handleEditJobType}
              onCancel={() => setIsEditingJobType(false)}
              onClose={() => {
                setIsEditingJobType(false);
              }}
            />
          )}

          {selectedJobType &&
            !isAddingJobType &&
            !isEditingJobType &&
            !isAddingChildJob &&
            !isEditingChildJob && (
              <div className="child-jobs-section">
                <div className="section-header">
                  <h3>Child Jobs for: {selectedJobType.JobTypeName}</h3>
                  <button
                    className="add-button"
                    onClick={() => setIsAddingChildJob(true)}
                  >
                    Add Child Job
                  </button>
                  <button
                    className="close-button"
                    onClick={() => setSelectedJobType(null)}
                  >
                    Close
                  </button>
                </div>

                <div className="child-jobs-list">
                  {childJobs.length > 0 ? (
                    <table>
                      <thead>
                        <tr>
                          <th>Job Type Name</th>
                          <th>DB Table Name</th>
                          <th>Screen Name</th>
                          <th>Has Siblings</th>
                          <th>Priority ID</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {childJobs.map((childJob) => (
                          <tr
                            key={childJob.ChildJobeId}
                            className={
                              selectedChildJob?.ChildJobeId ===
                              childJob.ChildJobeId
                                ? "selected"
                                : ""
                            }
                          >
                            <td>{childJob.JobTypeName}</td>
                            <td>{childJob.DBTableName}</td>
                            <td>{childJob.ScreenName}</td>
                            <td>{childJob.HasSiblings ? "Yes" : "No"}</td>
                            <td>{childJob.priority_id || "-"}</td>
                            <td>
                              <button
                                className="edit-button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedChildJob(childJob);
                                  setIsEditingChildJob(true);
                                  setIsAddingChildJob(false);
                                }}
                              >
                                Edit
                              </button>
                              <button
                                className="delete-button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteChildJob(childJob.ChildJobeId!);
                                }}
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="no-child-jobs-message">
                      <p>
                        No child jobs found for this job type. Add one using the
                        button above.
                      </p>
                      <button
                        className="dismiss-button"
                        onClick={() => setSelectedJobType(null)}
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

          {isAddingChildJob && selectedJobType && (
            <ChildJobForm
              parentJobType={selectedJobType}
              onSubmit={handleAddChildJob}
              onCancel={() => setIsAddingChildJob(false)}
            />
          )}

          {isEditingChildJob && selectedChildJob && (
            <ChildJobForm
              childJob={selectedChildJob}
              parentJobType={selectedJobType!}
              onSubmit={handleEditChildJob}
              onCancel={() => {
                setIsEditingChildJob(false);
                setSelectedChildJob(null);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default JobTypesManager;
