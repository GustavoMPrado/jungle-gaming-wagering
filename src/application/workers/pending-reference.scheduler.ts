import type {
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { PendingReferenceWorker } from './pending-reference.worker.js';

export class PendingReferenceScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private timer: ReturnType<typeof setTimeout> | null = null;
  private currentRun: Promise<void> | null = null;
  private running = false;
  private stopping = false;

  public constructor(
    private readonly worker: Pick<
      PendingReferenceWorker,
      'runOnce'
    >,
    private readonly intervalMs: number = 1000,
  ) {
    if (
      !Number.isInteger(intervalMs) ||
      intervalMs < 1
    ) {
      throw new Error('Invalid worker interval');
    }
  }

  public onModuleInit(): void {
    if (this.running || this.stopping) {
      return;
    }

    this.running = true;
    this.schedule(0);
  }

  public async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.running = false;

    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.currentRun !== null) {
      await this.currentRun;
    }
  }

  private schedule(delay: number): void {
    if (!this.running || this.stopping) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      this.currentRun = this.executeCycle();
    }, delay);
  }

  private async executeCycle(): Promise<void> {
    try {
      await this.worker.runOnce();
    } catch (error) {
      console.error(
        'Pending reference worker cycle failed',
        error,
      );
    } finally {
      this.currentRun = null;

      if (this.running && !this.stopping) {
        this.schedule(this.intervalMs);
      }
    }
  }
}
