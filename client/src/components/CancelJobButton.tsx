/**
 * A reusable button component for cancelling jobs in progress
 * Makes a POST request to the cancel endpoint and provides persistent visual feedback
 */
import React, { useState, useEffect } from "react";
import axios from "axios";
import "../styles/CancelButton.css";
import { toast } from "react-toastify";

interface CancelJobButtonProps {
  jobId: string;
  onSuccess?: () => void;
  onError?: (error: any) => void;
  buttonText?: string;
  disabled?: boolean;
  className?: string;
  jobStatus?: string;
  isAuthenticated?: boolean;
}

const CancelJobButton: React.FC<CancelJobButtonProps> = ({
  jobId,
  onSuccess,
  onError,
  buttonText = "Cancel",
  disabled = false,
  className = "",
  jobStatus,
  isAuthenticated = false,
}) => {
  const [isCancelling, setIsCancelling] = useState<boolean>(false);

  // Reset cancelling state if job ID changes
  useEffect(() => {
    setIsCancelling(false);
  }, [jobId]);

  // Set cancelling state if job status is already "Cancelling"
  useEffect(() => {
    if (jobStatus === "Cancelling") {
      setIsCancelling(true);
    }
  }, [jobStatus]);

  const handleCancelClick = async (): Promise<void> => {
    if (!jobId || isCancelling) return;

    // Check authentication before proceeding
    if (!isAuthenticated) {
      toast.error("Admin authentication required to cancel jobs");
      return;
    }

    try {
      setIsCancelling(true);
      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/job/cancel/${jobId}`
      );

      if (response.data.success) {
        console.log(`Job ${jobId} cancellation requested`);
        if (onSuccess) onSuccess();

        // Important: We no longer set isCancelling back to false
        // This ensures the button stays in "Cancelling..." state
      } else {
        console.error(`Failed to cancel job ${jobId}:`, response.data);
        if (onError) onError(response.data);
        setIsCancelling(false);
      }
    } catch (error) {
      console.error(`Error cancelling job ${jobId}:`, error);
      if (onError) onError(error);
      setIsCancelling(false);
    }
  };

  return (
    <button
      onClick={handleCancelClick}
      disabled={disabled || !jobId || isCancelling}
      className={`cancel-job-button ${isCancelling ? "cancelling" : ""} ${className}`}
      type="button"
    >
      {isCancelling ? "Cancelling..." : buttonText}
    </button>
  );
};

export default CancelJobButton;
