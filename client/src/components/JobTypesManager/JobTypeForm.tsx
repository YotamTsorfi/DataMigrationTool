/**
 * Form component for creating and editing job types with authentication protection
 */
import React, { useState } from "react";
import { IJobType } from "./JobTypesManager";

interface JobTypeFormProps {
  jobType?: IJobType;
  onSubmit: (jobType: IJobType) => void;
  onCancel: () => void;
  onClose?: () => void;
  isAuthenticated: boolean;
}

export const JobTypeForm: React.FC<JobTypeFormProps> = ({
  jobType,
  onSubmit,
  onCancel,
  onClose,
  isAuthenticated,
}) => {
  const [formState, setFormState] = useState<IJobType>({
    JobTypeName: "",
    DBTableName: "",
    ScreenName: "",
    SourceSystem: null,
    priority_id: null,
    linkedField: null,
    RunOrder: 0,
    ...jobType,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const { name, value } = e.target;
    setFormState({
      ...formState,
      [name]: value,
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

    if (!formState.JobTypeName.trim()) {
      newErrors.JobTypeName = "Job Type Name is required";
    }

    if (!formState.DBTableName.trim()) {
      newErrors.DBTableName = "DB Table Name is required";
    }

    if (!formState.ScreenName.trim()) {
      newErrors.ScreenName = "Screen Name is required";
    }

    if (typeof formState.RunOrder !== "number" || isNaN(formState.RunOrder)) {
      newErrors.RunOrder = "Run Order must be a valid number";
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
      <div className="form-header">
        <h3>{jobType ? "Edit Job Type" : "Add New Job Type"}</h3>
        {jobType && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="close-button"
            aria-label="Close form"
          >
            ×
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit}>
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

        <div className="form-group">
          <label htmlFor="linkedField">Linked Field (optional):</label>
          <input
            type="text"
            id="linkedField"
            name="linkedField"
            value={formState.linkedField || ""}
            onChange={handleChange}
            disabled={!isAuthenticated}
            data-auth-protected="true"
          />
        </div>

        <div className="form-group">
          <label htmlFor="RunOrder">Run Order:</label>
          <input
            type="number"
            id="RunOrder"
            name="RunOrder"
            value={formState.RunOrder}
            onChange={handleChange}
            className={errors.RunOrder ? "error" : ""}
            disabled={!isAuthenticated}
            data-auth-protected="true"
          />
          {errors.RunOrder && (
            <span className="error-text">{errors.RunOrder}</span>
          )}
        </div>

        <div className="form-actions">
          <button
            type="submit"
            className="submit-button"
            disabled={!isAuthenticated}
            data-auth-protected="true"
          >
            {jobType ? "Update" : "Create"} Job Type
          </button>
          <button type="button" onClick={onCancel} className="cancel-button">
            Cancel
          </button>
          {jobType && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="close-button-text"
            >
              Close Form
            </button>
          )}
        </div>
      </form>
    </div>
  );
};
