import { Injectable } from '@nestjs/common';

@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly durations = new Map<
    string,
    { count: number; totalMs: number; maxMs: number }
  >();

  public increment(name: string, amount = 1): void {
    this.counters.set(
      name,
      (this.counters.get(name) ?? 0) + amount,
    );
  }

  public observeDuration(name: string, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return;
    }

    const current = this.durations.get(name) ?? {
      count: 0,
      totalMs: 0,
      maxMs: 0,
    };

    current.count += 1;
    current.totalMs += durationMs;
    current.maxMs = Math.max(current.maxMs, durationMs);

    this.durations.set(name, current);
  }

  public snapshot(): {
    counters: Record<string, number>;
    durations: Record<
      string,
      {
        count: number;
        averageMs: number;
        maxMs: number;
      }
    >;
  } {
    const counters = Object.fromEntries(this.counters);

    const durations = Object.fromEntries(
      Array.from(this.durations, ([name, value]) => [
        name,
        {
          count: value.count,
          averageMs:
            value.count === 0 ? 0 : value.totalMs / value.count,
          maxMs: value.maxMs,
        },
      ]),
    );

    return { counters, durations };
  }
}
