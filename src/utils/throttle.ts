export class Throttle {
    private maxRequests: number;
    private interval: number;
    private queue: (() => Promise<void>)[] = [];
    private activeRequests: number = 0;
  
    constructor(maxRequests: number, interval: number) {
      this.maxRequests = maxRequests;
      this.interval = interval;
    }
  
    async addRequest(request: () => Promise<void>) {
      this.queue.push(request);
      this.processQueue();
    }
  
    private async processQueue() {
      if (this.activeRequests >= this.maxRequests || this.queue.length === 0) {
        return;
      }
  
      this.activeRequests++;
      const request = this.queue.shift();
      if (request) {
        try {
          await request();
        } catch (error) {
          console.error("Error processing request:", error);
        }
      }
      this.activeRequests--;
  
      setTimeout(() => this.processQueue(), this.interval);
    }
  }
