
export interface EnqueueOutboxMessageProps {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt?: Date;
}

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date;
  publishedAt?: Date;
  claimToken?: string;
  lockedUntil?: Date;
}

export class OutboxMessage {
  private static readonly LEASE_SECONDS = 30;

  private readonly _payload: Record<string, unknown>;
  private readonly _occurredAt: Date;

  private _attempts: number;
  private _nextAttemptAt?: Date;
  private _publishedAt?: Date;
  private _claimToken?: string;
  private _lockedUntil?: Date;

  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    payload: Record<string, unknown>,
    occurredAt: Date,
    attempts: number,
    nextAttemptAt?: Date,
    publishedAt?: Date,
    claimToken?: string,
    lockedUntil?: Date,
  ) {
    this._payload = OutboxMessage.copyPayload(payload);
    this._occurredAt = new Date(occurredAt.getTime());

    this._attempts = attempts;
    this._nextAttemptAt = OutboxMessage.copyDate(nextAttemptAt);
    this._publishedAt = OutboxMessage.copyDate(publishedAt);
    this._claimToken = claimToken;
    this._lockedUntil = OutboxMessage.copyDate(lockedUntil);
  }

  public static enqueue(
    props: EnqueueOutboxMessageProps,
  ): OutboxMessage {
    OutboxMessage.validateIdentification(
      props.id,
      props.aggregateId,
      props.eventType,
    );

    const occurredAt = props.occurredAt ?? new Date();
    OutboxMessage.validateDate(occurredAt);

    return new OutboxMessage(
      props.id,
      props.aggregateId,
      props.eventType,
      props.payload,
      occurredAt,
      0,
    );
  }

  public static rehydrate(
    state: OutboxMessageState,
  ): OutboxMessage {
    OutboxMessage.validateIdentification(
      state.id,
      state.aggregateId,
      state.eventType,
    );

    OutboxMessage.validateDate(state.occurredAt);

    if (!Number.isInteger(state.attempts) || state.attempts < 0) {
      throw new Error('Invalid outbox attempts');
    }

    if (state.nextAttemptAt) {
      OutboxMessage.validateDate(state.nextAttemptAt);
    }

    if (state.publishedAt) {
      OutboxMessage.validateDate(state.publishedAt);
    }

    if (state.lockedUntil) {
      OutboxMessage.validateDate(state.lockedUntil);
    }

    if (
      (state.claimToken === undefined) !==
      (state.lockedUntil === undefined)
    ) {
      throw new Error('Invalid outbox claim');
    }

    if (
      state.claimToken !== undefined &&
      !state.claimToken.trim()
    ) {
      throw new Error('Invalid outbox claim');
    }

    if (
      state.publishedAt &&
      (state.claimToken || state.lockedUntil)
    ) {
      throw new Error('Published message cannot be claimed');
    }

    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      state.payload,
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
      state.claimToken,
      state.lockedUntil,
    );
  }

  public get payload(): Record<string, unknown> {
    return OutboxMessage.copyPayload(this._payload);
  }

  public get occurredAt(): Date {
    return new Date(this._occurredAt.getTime());
  }

  public get attempts(): number {
    return this._attempts;
  }

  public get nextAttemptAt(): Date | undefined {
    return OutboxMessage.copyDate(this._nextAttemptAt);
  }

  public get publishedAt(): Date | undefined {
    return OutboxMessage.copyDate(this._publishedAt);
  }

  public get claimToken(): string | undefined {
    return this._claimToken;
  }

  public get lockedUntil(): Date | undefined {
    return OutboxMessage.copyDate(this._lockedUntil);
  }

  public isPending(): boolean {
    return this._publishedAt === undefined;
  }

  public isDue(now: Date = new Date()): boolean {
    OutboxMessage.validateDate(now);

    if (!this.isPending()) {
      return false;
    }

    if (
      this._nextAttemptAt &&
      this._nextAttemptAt.getTime() > now.getTime()
    ) {
      return false;
    }

    if (
      this._lockedUntil &&
      this._lockedUntil.getTime() > now.getTime()
    ) {
      return false;
    }

    return true;
  }

  public claim(
    token: string,
    now: Date = new Date(),
  ): void {
    if (!token?.trim()) {
      throw new Error('Outbox claim token is required');
    }

    if (!this.isDue(now)) {
      throw new Error('Outbox message is not available');
    }

    this._claimToken = token;
    this._lockedUntil = new Date(
      now.getTime() + OutboxMessage.LEASE_SECONDS * 1000,
    );
  }

  public markPublished(
    token: string,
    at: Date = new Date(),
  ): void {
    this.ensureClaim(token);
    OutboxMessage.validateDate(at);

    if (!this.isPending()) {
      throw new Error('Outbox message already published');
    }

    this._publishedAt = new Date(at.getTime());
    this._claimToken = undefined;
    this._lockedUntil = undefined;
    this._nextAttemptAt = undefined;
  }

  public scheduleRetry(
    token: string,
    nextAttemptAt: Date,
  ): void {
    this.ensureClaim(token);
    OutboxMessage.validateDate(nextAttemptAt);

    if (!this.isPending()) {
      throw new Error('Outbox message already published');
    }

    this._attempts++;
    this._nextAttemptAt = new Date(nextAttemptAt.getTime());
    this._claimToken = undefined;
    this._lockedUntil = undefined;
  }

  private ensureClaim(token: string): void {
    if (
      !token?.trim() ||
      this._claimToken === undefined ||
      this._claimToken !== token
    ) {
      throw new Error('Outbox claim token mismatch');
    }
  }

  private static validateIdentification(
    id: string,
    aggregateId: string,
    eventType: string,
  ): void {
    if (
      !id?.trim() ||
      !aggregateId?.trim() ||
      !eventType?.trim()
    ) {
      throw new Error('Invalid outbox identification');
    }
  }

  private static validateDate(date: Date): void {
    if (
      !(date instanceof Date) ||
      !Number.isFinite(date.getTime())
    ) {
      throw new Error('Invalid outbox date');
    }
  }

  private static copyDate(date?: Date): Date | undefined {
    return date ? new Date(date.getTime()) : undefined;
  }

  private static copyPayload(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload)
    ) {
      throw new Error('Invalid outbox payload');
    }

    try {
      const serialized = JSON.stringify(payload);

      if (!serialized) {
        throw new Error('Invalid payload');
      }

      return JSON.parse(serialized) as Record<string, unknown>;
    } catch {
      throw new Error('Invalid outbox payload');
    }
  }
}
