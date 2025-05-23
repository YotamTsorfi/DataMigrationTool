/**
 * Service to track and manage job cancellation requests.
 */
export class JobCancellationService {
  private static cancelledJobs: Set<string> = new Set();

  /**
   * Request cancellation for a specific job
   */
  public static requestCancellation(jobId: string): void {
    console.log(`Cancellation requested for job ${jobId}`);
    this.cancelledJobs.add(jobId);
  }

  /**
   * Check if a job has a pending cancellation request
   */
  public static isCancellationRequested(jobId: string): boolean {
    return this.cancelledJobs.has(jobId);
  }

  /**
   * Clear cancellation status after job is completed/stopped
   */
  public static clearCancellationRequest(jobId: string): void {
    this.cancelledJobs.delete(jobId);
  }
}
