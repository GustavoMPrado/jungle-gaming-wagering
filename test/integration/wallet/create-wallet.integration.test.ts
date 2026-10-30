import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';

import ormConfig from '../../../src/mikro-orm.config.js';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../src/domain/entities/wager-transaction.js';
import {
  LedgerDirection,
} from '../../../src/domain/entities/wallet-ledger-entry.js';
import { CreateWalletUseCase } from '../../../src/application/use-cases/wallet/create-wallet.use-case.js';
import { WalletRepository } from '../../../src/infrastructure/persistence/repository/wallet.repository.js';
import { WagerTransactionRepository } from '../../../src/infrastructure/persistence/repository/wager-transaction.repository.js';
import { WalletLedgerEntryRepository } from '../../../src/infrastructure/persistence/repository/wallet-ledger-entry.repository.js';
import { OutboxMessageRepository } from '../../../src/infrastructure/persistence/repository/outbox-message.repository.js';

describe('CreateWalletUseCase integration', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init(ormConfig);
  });

  afterAll(async () => {
    if (orm) {
      await orm.close();
    }
  });

  it('should create a zero-balance wallet without opening ledger', async () => {
    const playerId = `player-${crypto.randomUUID()}`;

    const useCase = new CreateWalletUseCase(orm.em);
    const result = await useCase.execute({
      playerId,
      currency: 'BRL',
      initialBalance: '0.00',
    });

    expect(result.playerId).toBe(playerId);
    expect(result.balance).toBe('0.00');
    expect(result.version).toBe(1);

    const wallet = await new WalletRepository(
      orm.em.fork(),
    ).findById(result.walletId);

    const entries = await new WalletLedgerEntryRepository(
      orm.em.fork(),
    ).findByWalletId(result.walletId);

    expect(wallet?.balance.toString()).toBe('0.00');
    expect(entries.length).toBe(0);
  });

  it('should commit positive opening balance with transaction, ledger and outbox', async () => {
    const playerId = `player-${crypto.randomUUID()}`;

    const useCase = new CreateWalletUseCase(orm.em);
    const result = await useCase.execute({
      playerId,
      currency: 'BRL',
      initialBalance: '100.00',
    });

    expect(result.balance).toBe('100.00');

    const entries = await new WalletLedgerEntryRepository(
      orm.em.fork(),
    ).findByWalletId(result.walletId);

    expect(entries.length).toBe(1);
    expect(entries[0]?.direction).toBe(LedgerDirection.Credit);
    expect(entries[0]?.isBalanced()).toBe(true);

    const opening = await new WagerTransactionRepository(
      orm.em.fork(),
    ).findById(entries[0]!.transactionId);

    expect(opening?.kind).toBe(WagerTransactionKind.Opening);
    expect(opening?.status).toBe(WagerTransactionStatus.Processed);

    const wallet = await new WalletRepository(
      orm.em.fork(),
    ).findById(result.walletId);

    expect(wallet?.balance.toString()).toBe('100.00');

    const outbox = new OutboxMessageRepository(orm.em.fork());

    const records = await orm.em.fork().getConnection().execute<
      { id: string }[]
    >(
      `select id
       from outbox_messages
       where aggregate_id = ?
          or payload->'data'->>'walletId' = ?`,
      [result.walletId, result.walletId],
    );

    expect(records.length).toBe(2);

    for (const record of records) {
      const event = await outbox.findById(record.id);
      expect(event?.isPending()).toBe(true);
    }
  });

  it('should reject a duplicate player and currency', async () => {
    const playerId = `player-${crypto.randomUUID()}`;
    const useCase = new CreateWalletUseCase(orm.em);

    await useCase.execute({
      playerId,
      currency: 'BRL',
      initialBalance: '0.00',
    });

    await expect(
      useCase.execute({
        playerId,
        currency: 'BRL',
        initialBalance: '0.00',
      }),
    ).rejects.toThrow('Wallet already exists');
  });

  it('should reject a negative opening balance', async () => {
    const useCase = new CreateWalletUseCase(orm.em);

    await expect(
      useCase.execute({
        playerId: `player-${crypto.randomUUID()}`,
        currency: 'BRL',
        initialBalance: '-10.00',
      }),
    ).rejects.toThrow();
  });
});
