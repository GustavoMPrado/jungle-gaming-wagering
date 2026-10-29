
import { Money } from '../value-objects/money.js';

export enum WagerTransactionKind {
  Opening = 'OPENING',
  Bet = 'BET',
  Win = 'WIN',
  Loss = 'LOSS',
  Refund = 'REFUND',
  Rollback = 'ROLLBACK',
}

export enum WagerTransactionStatus {
  Pending = 'PENDING',
  PendingReference = 'PENDING_REFERENCE',
  Processed = 'PROCESSED',
  Rejected = 'REJECTED',
  Failed = 'FAILED',
}

const REFERENCE_RETRY_DELAYS = [
  1, 2, 4, 8, 16, 32, 60, 60, 60, 60,
] as const;

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt?: Date;
}

export interface CreateOpeningTransactionProps {
  id: string;
  walletId: string;
  playerId: string;
  money: Money;
  createdAt?: Date;
}

export interface WagerTransactionState extends CreateWagerTransactionProps {
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: string;
  processedAt?: Date;
  referenceAttempts?: number;
  nextReferenceAttemptAt?: Date;
}

export class WagerTransaction {
  private static readonly maxReferenceAttempts =
    REFERENCE_RETRY_DELAYS.length;

  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    private readonly _createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: string,
    private _processedAt?: Date,
    private _referenceAttempts: number = 0,
    private _nextReferenceAttemptAt?: Date,
  ) {}

  public static create(
    props: CreateWagerTransactionProps,
  ): WagerTransaction {
    if (props.kind === WagerTransactionKind.Opening) {
      throw new Error('OPENING is an internal transaction');
    }

    if (!Object.values(WagerTransactionKind).includes(props.kind)) {
      throw new Error('Invalid transaction kind');
    }

    const requiredFields = [
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
    ];

    if (requiredFields.some((value) => !value?.trim())) {
      throw new Error('Invalid transaction identification');
    }

    if (
      props.kind === WagerTransactionKind.Refund ||
      props.kind === WagerTransactionKind.Rollback
    ) {
      if (!props.referenceExternalTransactionId?.trim()) {
        throw new Error('Transaction reference is required');
      }
    }

    if (!props.money.isPositive()) {
      throw new Error('Transaction amount must be positive');
    }

    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      new Date(props.createdAt ?? Date.now()),
      WagerTransactionStatus.Pending,
    );
  }

  public static createOpening(
    props: CreateOpeningTransactionProps,
  ): WagerTransaction {
    if (
      !props.id?.trim() ||
      !props.walletId?.trim() ||
      !props.playerId?.trim()
    ) {
      throw new Error('Invalid transaction identification');
    }

    if (!props.money.isPositive()) {
      throw new Error('Opening amount must be positive');
    }

    const createdAt = props.createdAt ?? new Date();

    return new WagerTransaction(
      props.id,
      'INTERNAL',
      props.id,
      `opening:${props.walletId}`,
      `opening:${props.walletId}`,
      props.walletId,
      props.playerId,
      'OPENING',
      'OPENING',
      WagerTransactionKind.Opening,
      props.money,
      undefined,
      new Date(createdAt.getTime()),
      WagerTransactionStatus.Processed,
      undefined,
      undefined,
      new Date(createdAt.getTime()),
    );
  }

  public static rehydrate(
    state: WagerTransactionState,
  ): WagerTransaction {
    const referenceAttempts = state.referenceAttempts ?? 0;

    if (
      !Number.isInteger(referenceAttempts) ||
      referenceAttempts < 0 ||
      referenceAttempts > WagerTransaction.maxReferenceAttempts
    ) {
      throw new Error('Invalid reference attempts');
    }

    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      new Date(state.createdAt ?? Date.now()),
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt
        ? new Date(state.processedAt)
        : undefined,
      referenceAttempts,
      state.nextReferenceAttemptAt
        ? new Date(state.nextReferenceAttemptAt)
        : undefined,
    );
  }

  public get createdAt(): Date {
    return new Date(this._createdAt.getTime());
  }

  public get status(): WagerTransactionStatus {
    return this._status;
  }

  public get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  public get failureCode(): string | undefined {
    return this._failureCode;
  }

  public get processedAt(): Date | undefined {
    return this._processedAt
      ? new Date(this._processedAt.getTime())
      : undefined;
  }

  public get referenceAttempts(): number {
    return this._referenceAttempts;
  }

  public get nextReferenceAttemptAt(): Date | undefined {
    return this._nextReferenceAttemptAt
      ? new Date(this._nextReferenceAttemptAt.getTime())
      : undefined;
  }

  public isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  public requiresReference(): boolean {
    return (
      this.kind === WagerTransactionKind.Refund ||
      this.kind === WagerTransactionKind.Rollback
    );
  }

  public hasReferenceAttemptsRemaining(): boolean {
    return (
      this._referenceAttempts <
      WagerTransaction.maxReferenceAttempts
    );
  }

  public isReferenceRetryDue(now: Date = new Date()): boolean {
    if (
      this._status !== WagerTransactionStatus.PendingReference ||
      !this._nextReferenceAttemptAt
    ) {
      return false;
    }

    return this._nextReferenceAttemptAt.getTime() <= now.getTime();
  }

  public markPendingReference(now: Date = new Date()): void {
    this.ensurePending();

    if (!this.requiresReference()) {
      throw new Error('Transaction does not require a reference');
    }

    this.ensureValidDate(now);

    this._status = WagerTransactionStatus.PendingReference;
    this._referenceAttempts = 0;

    this._nextReferenceAttemptAt = new Date(
      now.getTime() + REFERENCE_RETRY_DELAYS[0] * 1000,
    );
  }

  public recordReferenceAttempt(now: Date = new Date()): void {
    if (this._status !== WagerTransactionStatus.PendingReference) {
      throw new Error('Transaction is not pending reference');
    }

    this.ensureValidDate(now);

    if (!this.hasReferenceAttemptsRemaining()) {
      throw new Error('Reference retry limit reached');
    }

    if (!this.isReferenceRetryDue(now)) {
      throw new Error('Reference retry is not due');
    }

    this._referenceAttempts++;

    if (this.hasReferenceAttemptsRemaining()) {
      const delay = REFERENCE_RETRY_DELAYS[this._referenceAttempts];

      this._nextReferenceAttemptAt = new Date(
        now.getTime() + delay * 1000,
      );
    } else {
      this._nextReferenceAttemptAt = undefined;
    }
  }

  public markProcessed(
    at: Date = new Date(),
    referenceTransactionId?: string,
  ): void {
    this.ensureNotTerminal();
    this.ensureValidDate(at);

    if (referenceTransactionId !== undefined) {
      if (!referenceTransactionId.trim()) {
        throw new Error('Invalid reference transaction');
      }
    }

    const resolvedReference =
      referenceTransactionId ?? this._referenceTransactionId;

    if (this.requiresReference() && !resolvedReference) {
      throw new Error('Resolved reference is required');
    }

    this._referenceTransactionId = resolvedReference;
    this._status = WagerTransactionStatus.Processed;
    this._processedAt = new Date(at.getTime());
    this._nextReferenceAttemptAt = undefined;
  }

  public markRejected(code: string): void {
    this.ensureNotTerminal();
    this.ensureFailureCode(code);

    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._nextReferenceAttemptAt = undefined;
  }

  public markFailed(code: string): void {
    this.ensureNotTerminal();
    this.ensureFailureCode(code);

    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._nextReferenceAttemptAt = undefined;
  }

  private ensurePending(): void {
    if (this._status !== WagerTransactionStatus.Pending) {
      throw new Error('Transaction is not pending');
    }
  }

  private ensureNotTerminal(): void {
    if (this.isTerminal()) {
      throw new Error('Transaction is already terminal');
    }
  }

  private ensureFailureCode(code: string): void {
    if (!code?.trim()) {
      throw new Error('Failure code is required');
    }
  }

  private ensureValidDate(date: Date): void {
    if (!Number.isFinite(date.getTime())) {
      throw new Error('Invalid transaction date');
    }
  }
}

