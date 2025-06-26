/**
 * Form component for creating and editing child jobs with authentication protection
 */
import React, { useState } from "react";
import { IChildJob, IJobType } from "./JobTypesManager";

interface ChildJobFormProps {
  childJob?: IChildJob;
  parentJobType: IJobType;
  onSubmit: (childJob: IChildJob) => void;
  onCancel: () => void;
  isAuthenticated: boolean;
}

export const ChildJobForm: React.FC<ChildJobFormProps> = ({
  childJob,
  parentJobType,
  onSubmit,
  onCancel,
  isAuthenticated,
}) => {
  const [formState, setFormState] = useState<IChildJob>({
    ChildJobeId: undefined,
    JobTypeName: "",
    DBTableName: "",
    ScreenName: "",
    SourceSystem: null,
    priority_id: null,
    refParentJobId: parentJobType.JobTypeId || null,
    HasSiblings: false,
    ...childJob,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const { name, value, type, checked } = e.target;

    // Handle different input types
    const updatedValue =
      type === "checkbox"
        ? checked
        : name === "ChildJobeId"
          ? Number(value) || undefined
          : value;

    setFormState({
      ...formState,
      [name]: updatedValue,
    });

    // Clear error when field is edited
    if (errors[name]) {
      setErrors({
        ...errors,
        [name]: "",
      });
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (
      formState.ChildJobeId === undefined ||
      isNaN(Number(formState.ChildJobeId))
    ) {
      newErrors.ChildJobeId = "Child Job ID is required and must be a number";
    }

    if (!formState.JobTypeName.trim()) {
      newErrors.JobTypeName = "Job Type Name is required";
    }

    if (!formState.DBTableName.trim()) {
      newErrors.DBTableName = "DB Table Name is required";
    }

    if (!formState.ScreenName.trim()) {
      newErrors.ScreenName = "Screen Name is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();

    if (!isAuthenticated) {
      return; // Extra protection
    }

    if (validateForm()) {
      onSubmit(formState);
    }
  };

  return (
    <div className="form-container">
      <h3>{childJob ? "Edit Child Job" : "Add Child Job"}</h3>
      <p>Parent Job Type: {parentJobType.JobTypeName}</p>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="ChildJobeId">Child Job ID:</label>
          <input
            type="number"
            id="ChildJobeId"
            name="ChildJobeId"
            value={formState.ChildJobeId || ""}
            onChange={handleChange}
            className={errors.ChildJobeId ? "error" : ""}
            disabled={!!childJob} // Disable editing ID for existing child jobs
            data-auth-protected="true"
          />
          {errors.ChildJobeId && (
            <span className="error-text">{errors.ChildJobeId}</span>
          )}
          {childJob && (
            <small>Child Job ID cannot be changed after creation</small>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="JobTypeName">Job Type Name:</label>
          <input
            type="text"
            id="JobTypeName"
            name="JobTypeName"
            value={formState.JobTypeName}
            onChange={handleChange}
            className={errors.JobTypeName ? "error" : ""}
            disabled={!isAuthenticated}
            data-auth-protected="true"
          />
          {errors.JobTypeName && (
            <span className="error-text">{errors.JobTypeName}</span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="DBTableName">DB Table Name:</label>
          <input
            type="text"
            id="DBTableName"
            name="DBTableName"
            value={formState.DBTableName}
            onChange={handleChange}
            className={errors.DBTableName ? "error" : ""}
            disabled={!isAuthenticated}
            data-auth-protected="true"
          />
          {errors.DBTableName && (
            <span className="error-text">{errors.DBTableName}</span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="ScreenName">Screen Name:</label>
          <input
            type="text"
            id="ScreenName"
            name="ScreenName"
            value={formState.ScreenName}
            onChange={handleChange}
            className={errors.ScreenName ? "error" : ""}
            disabled={!isAuthenticated}
            data-auth-protected="true"
          />
          {errors.ScreenName && (
            <span className="error-text">{errors.ScreenName}</span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="SourceSystem">Source System (optional):</label>
          <input
            type="text"
            id="SourceSystem"
            name="SourceSystem"
            value={formState.SourceSystem || ""}
            onChange={handleChange}
            disabled={!isAuthenticated}
            data-auth-protected="true"
          />
        </div>

        <div className="form-group">
          <label htmlFor="priority_id">Priority ID (optional):</label>
          <input
            type="text"
            id="priority_id"
            name="priority_id"
            value={formState.priority_id || ""}
            onChange={handleChange}
            disabled={!isAuthenticated}
            data-auth-protected="true"
          />
        </div>

        <div className="form-group checkbox-group">
          <input
            type="checkbox"
            id="HasSiblings"
            name="HasSiblings"
            checked={formState.HasSiblings}
            onChange={handleChange}
            disabled={!isAuthenticated}
            data-auth-protected="true"
          />
          <label htmlFor="HasSiblings">Has Siblings</label>
        </div>

        <div className="form-actions">
          <button
            type="submit"
            className="submit-button"
            disabled={!isAuthenticated}
            data-auth-protected="true"
          >
            {childJob ? "Update" : "Create"} Child Job
          </button>
          <button type="button" onClick={onCancel} className="cancel-button">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};
