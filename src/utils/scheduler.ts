import { Throttle } from "./throttle";

export class Scheduler {
  private throttle: Throttle;

  constructor(maxRequests: number, interval: number) {
    this.throttle = new Throttle(maxRequests, interval);
  }

  async schedule(request: () => Promise<void>) {
    await this.throttle.addRequest(request);
  }
}