import {
  describe,
  expect,
  it,
} from 'bun:test';

import {
  PendingReferenceScheduler,
} from '../../src/application/workers/pending-reference.scheduler.js';

async function waitUntil(
  condition: () => boolean,
  timeoutMs = 1000,
): Promise<void> {
  const started = Date.now();

  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }

    await Bun.sleep(5);
  }
}

describe('PendingReferenceScheduler', () => {
  it('should run periodically and stop on shutdown', async () => {
    let executions = 0;

    const worker = {
      async runOnce() {
        executions++;
        return [];
      },
    };

    const scheduler = new PendingReferenceScheduler(
      worker,
      10,
    );

    scheduler.onModuleInit();

    try {
      await waitUntil(() => executions >= 2);
    } finally {
      await scheduler.onModuleDestroy();
    }

    const total = executions;

    await Bun.sleep(30);

    expect(total).toBeGreaterThanOrEqual(2);
    expect(executions).toBe(total);
  });

  it('should not overlap executions', async () => {
    let executions = 0;
    let active = 0;
    let maximumActive = 0;

    const worker = {
      async runOnce() {
        executions++;
        active++;

        maximumActive = Math.max(
          maximumActive,
          active,
        );

        await Bun.sleep(25);

        active--;

        return [];
      },
    };

    const scheduler = new PendingReferenceScheduler(
      worker,
      5,
    );

    scheduler.onModuleInit();

    try {
      await waitUntil(() => executions >= 3);
    } finally {
      await scheduler.onModuleDestroy();
    }

    expect(maximumActive).toBe(1);
    expect(active).toBe(0);
  });

  it('should wait for the current cycle during shutdown', async () => {
    let started = false;
    let finished = false;

    let release!: () => void;

    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });

    const worker = {
      async runOnce() {
        started = true;
        await pending;
        finished = true;
        return [];
      },
    };

    const scheduler = new PendingReferenceScheduler(
      worker,
      10,
    );

    scheduler.onModuleInit();

    await waitUntil(() => started);

    let shutdownCompleted = false;

    const shutdown = scheduler.onModuleDestroy().then(() => {
      shutdownCompleted = true;
    });

    try {
      await Bun.sleep(10);

      expect(shutdownCompleted).toBe(false);
    } finally {
      release();
      await shutdown;
    }

    expect(finished).toBe(true);
    expect(shutdownCompleted).toBe(true);
  });

  it('should reject an invalid interval', () => {
    const worker = {
      async runOnce() {
        return [];
      },
    };

    expect(
      () => new PendingReferenceScheduler(worker, 0),
    ).toThrow('Invalid worker interval');
  });
});
