import React from "react";
import { IJobType } from "./JobTypesManager";

interface JobTypesListProps {
  jobTypes: IJobType[];
  selectedJobType: IJobType | null;
  onSelect: (jobType: IJobType) => void;
  onEdit: (jobType: IJobType) => void;
  onDelete: (jobTypeId: number) => void;
}

export const JobTypesList: React.FC<JobTypesListProps> = ({
  jobTypes,
  selectedJobType,
  onSelect,
  onEdit,
  onDelete,
}) => {
  return (
    <div className="job-types-list">
      {jobTypes.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Job Type Name</th>
              <th>DB Table</th>
              <th>Screen Name</th>
              <th>Run Order</th>
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
                  <td>{jobType.JobTypeName}</td>
                  <td>{jobType.DBTableName}</td>
                  <td>{jobType.ScreenName}</td>
                  <td>{jobType.RunOrder}</td>
                  <td className="actions-cell">
                    <button
                      className="edit-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(jobType);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="delete-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(jobType.JobTypeId!);
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
        <p className="no-job-types">
          No job types found. Add one using the button above.
        </p>
      )}
    </div>
  );
};
