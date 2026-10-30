import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';

import ormConfig from '../../../src/mikro-orm.config.js';
import { Wallet } from '../../../src/domain/entities/wallet.js';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../src/domain/entities/wager-transaction.js';
import {
  LedgerDirection,
  WalletLedgerEntry,
} from '../../../src/domain/entities/wallet-ledger-entry.js';
import { Money } from '../../../src/domain/value-objects/money.js';
import { WalletRepository } from '../../../src/infrastructure/persistence/repository/wallet.repository.js';
import { WagerTransactionRepository } from '../../../src/infrastructure/persistence/repository/wager-transaction.repository.js';
import { WalletLedgerEntryRepository } from '../../../src/infrastructure/persistence/repository/wallet-ledger-entry.repository.js';

describe('Wager persistence integration', () => {
  let orm: MikroORM;

  const rollbackMarker = 'ROLLBACK_INTEGRATION_TEST';

  beforeAll(async () => {
    orm = await MikroORM.init(ormConfig);
  });

  afterAll(async () => {
    if (orm) {
      await orm.close();
    }
  });

  it('should persist wallet, WIN transaction and CREDIT ledger together', async () => {
    const walletId = crypto.randomUUID();
    const transactionId = crypto.randomUUID();
    const ledgerId = crypto.randomUUID();

    const wallet = Wallet.open({
      id: walletId,
      playerId: `player-${walletId}`,
      initialBalance: Money.create('0', 'BRL'),
    });

    const transaction = WagerTransaction.create({
      id: transactionId,
      providerId: 'provider-test',
      externalTransactionId: transactionId,
      idempotencyKey: `provider-test:${transactionId}`,
      payloadHash: 'hash-test',
      walletId,
      playerId: wallet.playerId,
      roundId: 'round-test',
      gameId: 'game-test',
      kind: WagerTransactionKind.Win,
      money: Money.create('25.00', 'BRL'),
    });

    const balanceBefore = wallet.balance;

    wallet.credit(transaction.money);
    transaction.markProcessed();

    const ledger = WalletLedgerEntry.create({
      id: ledgerId,
      walletId,
      transactionId,
      direction: LedgerDirection.Credit,
      money: transaction.money,
      balanceBefore,
      balanceAfter: wallet.balance,
    });

    try {
      await orm.em.fork().transactional(async (em) => {
        const wallets = new WalletRepository(em);
        const transactions = new WagerTransactionRepository(em);
        const entries = new WalletLedgerEntryRepository(em);

        await wallets.save(wallet);
        await transactions.save(transaction, wallet.balance);
        await entries.save(ledger);

        const storedWallet = await wallets.findById(walletId);
        const storedTransaction = await transactions.findById(
          transactionId,
        );
        const storedLedger = await entries.findByTransactionId(
          transactionId,
        );

        expect(storedWallet?.balance.toString()).toBe('25.00');
        expect(storedWallet?.version).toBe(2);

        expect(storedTransaction?.status).toBe(
          WagerTransactionStatus.Processed,
        );
        expect(storedTransaction?.kind).toBe(
          WagerTransactionKind.Win,
        );

        expect(storedLedger?.direction).toBe(
          LedgerDirection.Credit,
        );
        expect(storedLedger?.isBalanced()).toBe(true);
        expect(storedLedger?.balanceAfter.toString()).toBe('25.00');

        throw new Error(rollbackMarker);
      });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== rollbackMarker
      ) {
        throw error;
      }
    }

    const walletAfterRollback = await new WalletRepository(
      orm.em.fork(),
    ).findById(walletId);

    expect(walletAfterRollback).toBeNull();
  });

  it('should persist a processed LOSS without ledger entries', async () => {
    const walletId = crypto.randomUUID();
    const transactionId = crypto.randomUUID();

    const wallet = Wallet.open({
      id: walletId,
      playerId: `player-${walletId}`,
      initialBalance: Money.create('0', 'BRL'),
    });

    const transaction = WagerTransaction.create({
      id: transactionId,
      providerId: 'provider-test',
      externalTransactionId: transactionId,
      idempotencyKey: `provider-test:${transactionId}`,
      payloadHash: 'loss-hash',
      walletId,
      playerId: wallet.playerId,
      roundId: 'round-test',
      gameId: 'game-test',
      kind: WagerTransactionKind.Loss,
      money: Money.create('10.00', 'BRL'),
    });

    transaction.markProcessed();

    try {
      await orm.em.fork().transactional(async (em) => {
        const wallets = new WalletRepository(em);
        const transactions = new WagerTransactionRepository(em);
        const entries = new WalletLedgerEntryRepository(em);

        await wallets.save(wallet);
        await transactions.save(transaction, wallet.balance);

        const stored = await transactions.findByExternalId(
          'provider-test',
          transactionId,
        );

        const ledger = await entries.findByTransactionId(
          transactionId,
        );

        expect(stored?.kind).toBe(WagerTransactionKind.Loss);
        expect(stored?.status).toBe(
          WagerTransactionStatus.Processed,
        );
        expect(ledger).toBeNull();

        throw new Error(rollbackMarker);
      });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== rollbackMarker
      ) {
        throw error;
      }
    }
  });

  it('should retrieve a transaction by idempotency key', async () => {
    const walletId = crypto.randomUUID();
    const transactionId = crypto.randomUUID();

    const wallet = Wallet.open({
      id: walletId,
      playerId: `player-${walletId}`,
      initialBalance: Money.create('0', 'BRL'),
    });

    const transaction = WagerTransaction.create({
      id: transactionId,
      providerId: 'provider-test',
      externalTransactionId: transactionId,
      idempotencyKey: `provider-test:${transactionId}`,
      payloadHash: 'pending-hash',
      walletId,
      playerId: wallet.playerId,
      roundId: 'round-test',
      gameId: 'game-test',
      kind: WagerTransactionKind.Bet,
      money: Money.create('10.00', 'BRL'),
    });

    transaction.markRejected('INSUFFICIENT_BALANCE');

    try {
      await orm.em.fork().transactional(async (em) => {
        const wallets = new WalletRepository(em);
        const transactions = new WagerTransactionRepository(em);

        await wallets.save(wallet);
        await transactions.save(transaction, wallet.balance);

        const stored = await transactions.findByIdempotencyKey(
          transaction.idempotencyKey,
        );

        expect(stored?.id).toBe(transactionId);
        expect(stored?.status).toBe(
          WagerTransactionStatus.Rejected,
        );
        expect(stored?.failureCode).toBe(
          'INSUFFICIENT_BALANCE',
        );

        throw new Error(rollbackMarker);
      });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== rollbackMarker
      ) {
        throw error;
      }
    }
  });
});
