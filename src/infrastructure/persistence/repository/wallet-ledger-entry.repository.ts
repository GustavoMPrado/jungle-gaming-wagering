import type { EntityManager } from '@mikro-orm/postgresql';
import {
  LedgerDirection,
  WalletLedgerEntry,
} from '../../../domain/entities/wallet-ledger-entry.js';
import { Money } from '../../../domain/value-objects/money.js';
import { WalletLedgerEntryRecord } from '../entities/wallet-ledger-entry-record.entity.js';

export interface LedgerCursor {
  createdAt: Date;
  id: string;
}

export interface LedgerPage {
  entries: WalletLedgerEntry[];
  hasMore: boolean;
}

export class WalletLedgerEntryRepository {
  public constructor(
    private readonly em: EntityManager,
  ) {}

  public async findById(
    id: string,
  ): Promise<WalletLedgerEntry | null> {
    const record = await this.em.findOne(
      WalletLedgerEntryRecord,
      { id },
    );

    return record ? this.toDomain(record) : null;
  }

  public async findByTransactionId(
    transactionId: string,
  ): Promise<WalletLedgerEntry | null> {
    const record = await this.em.findOne(
      WalletLedgerEntryRecord,
      { transactionId },
    );

    return record ? this.toDomain(record) : null;
  }

  public async findByWalletId(
    walletId: string,
  ): Promise<WalletLedgerEntry[]> {
    const records = await this.em.find(
      WalletLedgerEntryRecord,
      { walletId },
      {
        orderBy: {
          createdAt: 'ASC',
          id: 'ASC',
        },
      },
    );

    return records.map((record) => this.toDomain(record));
  }

  public async findPageByWalletId(
    walletId: string,
    limit: number,
    cursor?: LedgerCursor,
  ): Promise<LedgerPage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Invalid ledger page limit');
    }

    const filter = cursor
      ? {
          walletId,
          $or: [
            { createdAt: { $gt: cursor.createdAt } },
            {
              createdAt: cursor.createdAt,
              id: { $gt: cursor.id },
            },
          ],
        }
      : { walletId };

    const records = await this.em.find(
      WalletLedgerEntryRecord,
      filter,
      {
        orderBy: {
          createdAt: 'ASC',
          id: 'ASC',
        },
        limit: limit + 1,
      },
    );

    return {
      entries: records
        .slice(0, limit)
        .map((record) => this.toDomain(record)),
      hasMore: records.length > limit,
    };
  }

  public async save(
    entry: WalletLedgerEntry,
  ): Promise<void> {
    const existing = await this.em.findOne(
      WalletLedgerEntryRecord,
      { id: entry.id },
    );

    if (existing) {
      throw new Error('Ledger entry already exists');
    }

    const record = new WalletLedgerEntryRecord();

    record.id = entry.id;
    record.walletId = entry.walletId;
    record.transactionId = entry.transactionId;
    record.direction = entry.direction;
    record.amount = entry.money.toString();
    record.currency = entry.money.currency;
    record.balanceBefore = entry.balanceBefore.toString();
    record.balanceAfter = entry.balanceAfter.toString();
    record.createdAt = entry.createdAt;

    this.em.persist(record);
    await this.em.flush();
  }

  private toDomain(
    record: WalletLedgerEntryRecord,
  ): WalletLedgerEntry {
    return WalletLedgerEntry.rehydrate({
      id: record.id,
      walletId: record.walletId,
      transactionId: record.transactionId,
      direction: record.direction as LedgerDirection,
      money: Money.create(record.amount, record.currency),
      balanceBefore: Money.create(
        record.balanceBefore,
        record.currency,
      ),
      balanceAfter: Money.create(
        record.balanceAfter,
        record.currency,
      ),
      createdAt: record.createdAt,
    });
  }
}
