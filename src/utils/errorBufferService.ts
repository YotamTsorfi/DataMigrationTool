import { performBulkErrorInsertWithService } from "../services/dataService";
import PerformanceMonitor from "./performanceMonitor";

export class ErrorBufferService {
  private static instance: ErrorBufferService;
  private errorBuffer: any[] = [];
  private lastFlushTime: number = Date.now();
  private flushSize: number = 500; // Increased from 100 to 500
  private minFlushSize: number = 100; // New parameter: minimum size for non-forced flushes
  private flushInterval: number = 30000; // Increased from 10s to 30s
  private isProcessing: boolean = false;
  private perfMonitor: PerformanceMonitor;
  private forceFlushScheduled: boolean = false;

  private constructor() {
    this.perfMonitor = new PerformanceMonitor();
  }

  /**
   * Get the singleton instance of ErrorBufferService
   */
  public static getInstance(): ErrorBufferService {
    if (!ErrorBufferService.instance) {
      ErrorBufferService.instance = new ErrorBufferService();
    }
    return ErrorBufferService.instance;
  }

  /**
   * Add errors to the buffer
   */
  public addErrors(errors: any[]): void {
    if (!errors || errors.length === 0) return;
    
    this.errorBuffer.push(...errors);
    
    // Check if we should flush based on buffer size
    if (this.errorBuffer.length >= this.flushSize) {
      this.flush();
    } 
    // Check if we should flush based on time elapsed, but only if we have enough errors
    else if (Date.now() - this.lastFlushTime > this.flushInterval && 
             this.errorBuffer.length >= this.minFlushSize) {
      this.flush();
    }
    // Schedule a delayed flush for small batches
    else if (!this.forceFlushScheduled && 
             this.errorBuffer.length > 0 && 
             this.errorBuffer.length < this.minFlushSize && 
             Date.now() - this.lastFlushTime > this.flushInterval) {
      this.forceFlushScheduled = true;
      setTimeout(() => {
        this.forceFlushScheduled = false;
        if (this.errorBuffer.length > 0) {
          this.flush();
        }
      }, 5000); // Wait additional 5 seconds before flushing small batches
    }
  }

  /**
   * Configure buffer parameters
   */
  public configure(options: { 
    flushSize?: number; 
    flushInterval?: number;
    minFlushSize?: number; 
  }): void {
    if (options.flushSize) this.flushSize = options.flushSize;
    if (options.flushInterval) this.flushInterval = options.flushInterval;
    if (options.minFlushSize) this.minFlushSize = options.minFlushSize;
  }

  /**
   * Flush the error buffer to the database
   */
  public async flush(): Promise<void> {
    // Don't flush if already processing or if buffer is empty
    if (this.isProcessing || this.errorBuffer.length === 0) {
      return;
    }

    this.isProcessing = true;
    const errorsToProcess = [...this.errorBuffer];
    this.errorBuffer = []; // Clear buffer immediately
    this.lastFlushTime = Date.now();

    try {
      this.perfMonitor.startOperation();
      await performBulkErrorInsertWithService(
        errorsToProcess,
        this.perfMonitor,
        5000 // Increased batch size from 500 to 1000
      );
      this.perfMonitor.endOperation();
      
      // Only log details for larger batches, use debug for small ones
      if (errorsToProcess.length > 50) {
        console.log(`Flushed ${errorsToProcess.length} buffered errors to database`);
      } else {
        console.debug(`Flushed ${errorsToProcess.length} buffered errors to database`);
      }
    } catch (error) {
      console.error(`Error flushing buffered errors: ${error instanceof Error ? error.message : error}`);
      
      // If flush fails, try to reinsert the errors back into the buffer
      // but only up to the flush size to prevent overwhelming the buffer
      const reinsertCount = Math.min(errorsToProcess.length, this.flushSize);
      this.errorBuffer.push(...errorsToProcess.slice(0, reinsertCount));
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Get the current number of errors in the buffer
   */
  public getBufferSize(): number {
    return this.errorBuffer.length;
  }

  /**
   * Force flush all remaining errors - should be called at job completion
   */
  public async flushAll(): Promise<void> {
    if (this.errorBuffer.length > 0) {
      // Force flush regardless of batch size
      await this.flush();
      
      // If there are still errors that weren't processed (due to concurrent operations)
      // try once more after a short delay
      if (this.errorBuffer.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
        await this.flush();
      }
    }
  }

  /**
   * Reset the buffer - useful for testing or when switching between jobs
   */
  public reset(): void {
    this.errorBuffer = [];
    this.lastFlushTime = Date.now();
  }
}
