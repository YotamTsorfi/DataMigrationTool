/**
 * Component for displaying a list of job types with authentication-protected actions
 */
import React from "react";
import { IJobType } from "./JobTypesManager";

interface JobTypesListProps {
  jobTypes: IJobType[];
  selectedJobType: IJobType | null;
  onSelect: (jobType: IJobType) => void;
  onEdit: (jobType: IJobType) => void;
  onDelete: (jobTypeId: number) => void;
  isAuthenticated: boolean;
}

export const JobTypesList: React.FC<JobTypesListProps> = ({
  jobTypes,
  selectedJobType,
  onSelect,
  onEdit,
  onDelete,
  isAuthenticated,
}) => {
  return (
    <div className="job-types-list">
      {jobTypes.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th className="narrow-column id-column">ID</th>
              <th className="job-type-name-column">Job Type Name</th>
              <th className="screen-name-column">Screen Name</th>
              <th className="narrow-column">Run Order</th>
              <th className="db-table-column">DB Table</th>
              <th>Priority ID</th>
              <th>Reference ID</th>
              <th className="narrow-column">Ready</th>
              <th>Dependency</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobTypes
              .sort((a, b) => a.RunOrder - b.RunOrder)
              .map((jobType) => (
                <tr
                  key={jobType.JobTypeId}
                  className={
                    selectedJobType?.JobTypeId === jobType.JobTypeId
                      ? "selected"
                      : ""
                  }
                  onClick={() => onSelect(jobType)}
                >
                  <td>{jobType.JobTypeId}</td>
                  <td className="job-type-name-column">
                    {jobType.JobTypeName}
                  </td>
                  <td className="screen-name-column">{jobType.ScreenName}</td>
                  <td>{jobType.RunOrder}</td>
                  <td className="db-table-column">{jobType.DBTableName}</td>
                  <td>{jobType.priority_id}</td>
                  <td>{jobType.linkedField}</td>
                  <td>{jobType.isReady ? "Yes" : "No"}</td>
                  <td>{jobType.hasDependency ? "Yes" : "No"}</td>
                  <td className="actions-cell">
                    <button
                      className="edit-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(jobType);
                      }}
                      data-auth-protected="true"
                      disabled={!isAuthenticated}
                    >
                      Edit
                    </button>
                    <button
                      className="delete-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(jobType.JobTypeId!);
                      }}
                      data-auth-protected="true"
                      disabled={!isAuthenticated}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      ) : (
        <p className="no-job-types">
          No job types found. Add one using the button above.
        </p>
      )}
    </div>
  );
};
