import type { EntityManager } from '@mikro-orm/postgresql';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/entities/wager-transaction.js';
import { Money } from '../../domain/value-objects/money.js';
import { WagerTransactionRecord } from './wager-transaction-record.entity.js';

export class WagerTransactionRepository {
  public constructor(
    private readonly em: EntityManager,
  ) {}

  public async findById(
    id: string,
  ): Promise<WagerTransaction | null> {
    const record = await this.em.findOne(
      WagerTransactionRecord,
      { id },
    );

    return record ? this.toDomain(record) : null;
  }

  public async findByIdempotencyKey(
    key: string,
  ): Promise<WagerTransaction | null> {
    const record = await this.em.findOne(
      WagerTransactionRecord,
      { idempotencyKey: key },
    );

    return record ? this.toDomain(record) : null;
  }

  public async findByExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const record = await this.em.findOne(
      WagerTransactionRecord,
      { providerId, externalTransactionId },
    );

    return record ? this.toDomain(record) : null;
  }

  public async save(
    transaction: WagerTransaction,
    resultBalance?: Money,
  ): Promise<void> {
    let record = await this.em.findOne(
      WagerTransactionRecord,
      { id: transaction.id },
    );

    if (!record) {
      record = new WagerTransactionRecord();
      record.id = transaction.id;
    }

    record.providerId = transaction.providerId;
    record.externalTransactionId =
      transaction.externalTransactionId;
    record.idempotencyKey = transaction.idempotencyKey;
    record.payloadHash = transaction.payloadHash;
    record.walletId = transaction.walletId;
    record.playerId = transaction.playerId;
    record.roundId = transaction.roundId;
    record.gameId = transaction.gameId;
    record.kind = transaction.kind;
    record.amount = transaction.money.toString();
    record.currency = transaction.money.currency;
    record.status = transaction.status;
    record.referenceExternalTransactionId =
      transaction.referenceExternalTransactionId;
    record.referenceTransactionId =
      transaction.referenceTransactionId;
    record.failureCode = transaction.failureCode;
    record.referenceAttempts = transaction.referenceAttempts;
    record.nextReferenceAttemptAt =
      transaction.nextReferenceAttemptAt;
    record.createdAt = transaction.createdAt;
    record.processedAt = transaction.processedAt;

    if (resultBalance !== undefined) {
      if (resultBalance.currency !== transaction.money.currency) {
        throw new Error('Currency mismatch');
      }

      record.resultBalance = resultBalance.toString();
    }

    this.em.persist(record);
    await this.em.flush();
  }

  private toDomain(
    record: WagerTransactionRecord,
  ): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: record.id,
      providerId: record.providerId,
      externalTransactionId: record.externalTransactionId,
      idempotencyKey: record.idempotencyKey,
      payloadHash: record.payloadHash,
      walletId: record.walletId,
      playerId: record.playerId,
      roundId: record.roundId,
      gameId: record.gameId,
      kind: record.kind as WagerTransactionKind,
      money: Money.create(record.amount, record.currency),
      referenceExternalTransactionId:
        record.referenceExternalTransactionId ?? undefined,
      status: record.status as WagerTransactionStatus,
      referenceTransactionId:
        record.referenceTransactionId ?? undefined,
      failureCode: record.failureCode ?? undefined,
      referenceAttempts: record.referenceAttempts,
      nextReferenceAttemptAt:
        record.nextReferenceAttemptAt ?? undefined,
      createdAt: record.createdAt,
      processedAt: record.processedAt ?? undefined,
    });
  }
}
