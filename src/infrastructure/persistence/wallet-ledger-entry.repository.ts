import type { EntityManager } from '@mikro-orm/postgresql';
import {
  LedgerDirection,
  WalletLedgerEntry,
} from '../../domain/entities/wallet-ledger-entry.js';
import { Money } from '../../domain/value-objects/money.js';
import { WalletLedgerEntryRecord } from './wallet-ledger-entry-record.entity.js';

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
