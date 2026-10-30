import {
  LockMode,
  type EntityManager,
} from '@mikro-orm/postgresql';
import { Wallet } from '../../domain/entities/wallet.js';
import { Money } from '../../domain/value-objects/money.js';
import { WalletRecord } from './wallet-record.entity.js';

export class WalletRepository {
  public constructor(
    private readonly em: EntityManager,
  ) {}

  public async findById(
    id: string,
  ): Promise<Wallet | null> {
    const record = await this.em.findOne(WalletRecord, {
      id,
    });

    return record ? this.toDomain(record) : null;
  }

  public async findByIdForUpdate(
    id: string,
  ): Promise<Wallet | null> {
    const record = await this.em.findOne(
      WalletRecord,
      { id },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );

    return record ? this.toDomain(record) : null;
  }

  public async findByPlayerAndCurrency(
    playerId: string,
    currency: string,
  ): Promise<Wallet | null> {
    const record = await this.em.findOne(WalletRecord, {
      playerId,
      currency,
    });

    return record ? this.toDomain(record) : null;
  }

  public async save(wallet: Wallet): Promise<void> {
    let record = await this.em.findOne(WalletRecord, {
      id: wallet.id,
    });

    if (!record) {
      record = new WalletRecord();
      record.id = wallet.id;
      record.createdAt = wallet.createdAt;
    }

    record.playerId = wallet.playerId;
    record.currency = wallet.currency;
    record.balance = wallet.balance.toString();
    record.version = wallet.version;
    record.updatedAt = wallet.updatedAt;

    this.em.persist(record);
    await this.em.flush();
  }

  private toDomain(record: WalletRecord): Wallet {
    return Wallet.rehydrate({
      id: record.id,
      playerId: record.playerId,
      balance: Money.create(
        record.balance,
        record.currency,
      ),
      version: record.version,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}
