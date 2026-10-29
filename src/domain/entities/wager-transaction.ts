
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

export interface WagerTransactionState extends CreateWagerTransactionProps {
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: string;
  processedAt?: Date;
}

export class WagerTransaction {
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
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: string,
    private _processedAt?: Date,
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

  public static rehydrate(
    state: WagerTransactionState,
  ): WagerTransaction {
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
    );
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
      ? new Date(this._processedAt)
      : undefined;
  }

  public isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  public markPendingReference(): void {
    this.ensurePending();

    if (
      this.kind !== WagerTransactionKind.Refund &&
      this.kind !== WagerTransactionKind.Rollback
    ) {
      throw new Error('Transaction does not require a reference');
    }

    this._status = WagerTransactionStatus.PendingReference;
  }

  public markProcessed(
    at: Date = new Date(),
    referenceTransactionId?: string,
  ): void {
    this.ensureNotTerminal();

    if (referenceTransactionId !== undefined) {
      if (!referenceTransactionId.trim()) {
        throw new Error('Invalid reference transaction');
      }

      this._referenceTransactionId = referenceTransactionId;
    }

    if (
      (this.kind === WagerTransactionKind.Refund ||
        this.kind === WagerTransactionKind.Rollback) &&
      !this._referenceTransactionId
    ) {
      throw new Error('Resolved reference is required');
    }

    this._status = WagerTransactionStatus.Processed;
    this._processedAt = new Date(at);
  }

  public markRejected(code: string): void {
    this.ensureNotTerminal();
    this.ensureFailureCode(code);

    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
  }

  public markFailed(code: string): void {
    this.ensureNotTerminal();
    this.ensureFailureCode(code);

    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
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
}
