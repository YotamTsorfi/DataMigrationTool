import React, { useState, useEffect } from "react";
import { IChildJob, IJobType } from "./JobTypesManager";

interface ChildJobFormProps {
  childJob?: IChildJob;
  parentJobType: IJobType;
  onSubmit: (childJob: IChildJob) => void;
  onCancel: () => void;
}

export const ChildJobForm: React.FC<ChildJobFormProps> = ({
  childJob,
  parentJobType,
  onSubmit,
  onCancel,
}) => {
  const [formData, setFormData] = useState<IChildJob>({
    JobTypeName: parentJobType.JobTypeName,
    DBTableName: "",
    ScreenName: "",
    SourceSystem: parentJobType.SourceSystem,
    priority_id: "",
    refParentJobId: parentJobType.JobTypeId || null,
    HasSiblings: true,
  });

  const [formErrors, setFormErrors] = useState({
    DBTableName: false,
    ScreenName: false,
  });

  useEffect(() => {
    if (childJob) {
      setFormData(childJob);
    }
  }, [childJob]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target as HTMLInputElement;

    if (type === "checkbox") {
      setFormData({
        ...formData,
        [name]: (e.target as HTMLInputElement).checked,
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
      };

      onSubmit(submissionData);
    }
  };

  return (
    <div className="form-container">
      <h3>{childJob ? "Edit Child Job" : "Add New Child Job"}</h3>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="JobTypeName">Job Type Name</label>
          <input
            type="text"
            id="JobTypeName"
            name="JobTypeName"
            value={formData.JobTypeName}
            onChange={handleChange}
            disabled
          />
          <small>Inherited from parent job type</small>
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

        <div className="form-group checkbox-group">
          <label htmlFor="HasSiblings">
            <input
              type="checkbox"
              id="HasSiblings"
              name="HasSiblings"
              checked={formData.HasSiblings}
              onChange={(e) => {
                setFormData({
                  ...formData,
                  HasSiblings: e.target.checked,
                });
              }}
            />
            Has Siblings
          </label>
          <small>Enable if child records should be treated as an array</small>
        </div>

        <div className="form-actions">
          <button type="submit" className="submit-button">
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
