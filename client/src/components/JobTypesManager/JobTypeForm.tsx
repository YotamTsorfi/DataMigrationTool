import React, { useState, useEffect } from "react";
import { IJobType } from "./JobTypesManager";

interface JobTypeFormProps {
  jobType?: IJobType;
  onSubmit: (jobType: IJobType) => void;
  onCancel: () => void;
  onClose?: () => void;
}

export const JobTypeForm: React.FC<JobTypeFormProps> = ({
  jobType,
  onSubmit,
  onCancel,
  onClose,
}) => {
  const [formData, setFormData] = useState<IJobType>({
    JobTypeName: "",
    DBTableName: "",
    ScreenName: "",
    SourceSystem: "",
    priority_id: "",
    linkedField: "",
    RunOrder: 0,
  });

  const [formErrors, setFormErrors] = useState({
    JobTypeName: false,
    DBTableName: false,
    ScreenName: false,
  });

  useEffect(() => {
    if (jobType) {
      setFormData(jobType);
    }
  }, [jobType]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;

    // Handle number type for RunOrder
    if (name === "RunOrder") {
      setFormData({
        ...formData,
        [name]: parseInt(value) || 0,
      });
    } else {
      setFormData({
        ...formData,
        [name]: value,
      });
    }

    // Clear validation errors when field is modified
    if (name in formErrors) {
      setFormErrors({
        ...formErrors,
        [name]: false,
      });
    }
  };

  const validateForm = (): boolean => {
    const errors = {
      JobTypeName: !formData.JobTypeName,
      DBTableName: !formData.DBTableName,
      ScreenName: !formData.ScreenName,
    };

    setFormErrors(errors);

    return !Object.values(errors).some(Boolean);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (validateForm()) {
      // Convert empty strings to null
      const submissionData = {
        ...formData,
        SourceSystem: formData.SourceSystem || null,
        priority_id: formData.priority_id || null,
        linkedField: formData.linkedField || null,
      };

      onSubmit(submissionData);
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
          <label htmlFor="JobTypeName">Job Type Name *</label>
          <input
            type="text"
            id="JobTypeName"
            name="JobTypeName"
            value={formData.JobTypeName}
            onChange={handleChange}
            className={formErrors.JobTypeName ? "error" : ""}
          />
          {formErrors.JobTypeName && (
            <span className="error-text">Job Type Name is required</span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="DBTableName">DB Table Name *</label>
          <input
            type="text"
            id="DBTableName"
            name="DBTableName"
            value={formData.DBTableName}
            onChange={handleChange}
            className={formErrors.DBTableName ? "error" : ""}
          />
          {formErrors.DBTableName && (
            <span className="error-text">DB Table Name is required</span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="ScreenName">Screen Name *</label>
          <input
            type="text"
            id="ScreenName"
            name="ScreenName"
            value={formData.ScreenName}
            onChange={handleChange}
            className={formErrors.ScreenName ? "error" : ""}
          />
          {formErrors.ScreenName && (
            <span className="error-text">Screen Name is required</span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="SourceSystem">Source System</label>
          <input
            type="text"
            id="SourceSystem"
            name="SourceSystem"
            value={formData.SourceSystem || ""}
            onChange={handleChange}
          />
        </div>

        <div className="form-group">
          <label htmlFor="priority_id">Priority ID</label>
          <input
            type="text"
            id="priority_id"
            name="priority_id"
            value={formData.priority_id || ""}
            onChange={handleChange}
          />
        </div>

        <div className="form-group">
          <label htmlFor="linkedField">Linked Field</label>
          <input
            type="text"
            id="linkedField"
            name="linkedField"
            value={formData.linkedField || ""}
            onChange={handleChange}
          />
        </div>

        <div className="form-group">
          <label htmlFor="RunOrder">Run Order</label>
          <input
            type="number"
            id="RunOrder"
            name="RunOrder"
            value={formData.RunOrder}
            onChange={handleChange}
          />
        </div>

        <div className="form-actions">
          <button type="submit" className="submit-button">
            {jobType ? "Update" : "Create"} Job Type
          </button>
          <button type="button" onClick={onCancel} className="cancel-button">
            Cancel
          </button>
          {jobType && (
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
