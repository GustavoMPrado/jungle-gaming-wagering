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
import { Money } from '../../../src/domain/value-objects/money.js';
import { InboxMessage } from '../../../src/domain/entities/inbox-message.js';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../src/domain/entities/wager-transaction.js';
import { WalletRepository } from '../../../src/infrastructure/persistence/repository/wallet.repository.js';
import { InboxMessageRepository } from '../../../src/infrastructure/persistence/repository/inbox-message.repository.js';
import { WagerTransactionRepository } from '../../../src/infrastructure/persistence/repository/wager-transaction.repository.js';
import { WalletLedgerEntryRepository } from '../../../src/infrastructure/persistence/repository/wallet-ledger-entry.repository.js';
import {
  ProcessWagerTransactionUseCase,
  type ProcessWagerTransactionInput,
} from '../../../src/application/use-cases/wagering/process-wager-transaction.use-case.js';

describe('Inbox transaction integration', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init(ormConfig);
  });

  afterAll(async () => {
    if (orm) {
      await orm.close();
    }
  });

  it('should commit inbox and financial changes together', async () => {
    const walletId = crypto.randomUUID();
    const playerId = `player-${walletId}`;
    const messageId = crypto.randomUUID();
    const transactionId = crypto.randomUUID();
    const consumerName = 'wagering-consumer';

    const wallet = Wallet.open({
      id: walletId,
      playerId,
      initialBalance: Money.create('0', 'BRL'),
    });

    await new WalletRepository(orm.em.fork()).save(wallet);

    const input: ProcessWagerTransactionInput = {
      transactionId,
      walletId,
      playerId,
      providerId: 'inbox-integration-provider',
      externalTransactionId: crypto.randomUUID(),
      idempotencyKey: `inbox:${crypto.randomUUID()}`,
      payloadHash: 'financial-payload-hash',
      roundId: 'round-inbox',
      gameId: 'game-inbox',
      kind: WagerTransactionKind.Win,
      amount: '50.00',
      currency: 'BRL',
      correlationId: crypto.randomUUID(),
    };

    await orm.em.fork().transactional(async (em) => {
      const inboxRepository = new InboxMessageRepository(em);
      const useCase = new ProcessWagerTransactionUseCase(em);

      const message = InboxMessage.receive({
        messageId,
        consumerName,
        payloadHash: 'message-payload-hash',
      });

      await inboxRepository.save(message);

      const result = await useCase.execute(input, em);

      expect(result.status).toBe(WagerTransactionStatus.Processed);
      expect(result.balance).toBe('50.00');

      message.markProcessed();
      await inboxRepository.save(message);
    });

    const storedInbox = await new InboxMessageRepository(
      orm.em.fork(),
    ).findById(consumerName, messageId);

    const storedWallet = await new WalletRepository(
      orm.em.fork(),
    ).findById(walletId);

    const storedTransaction = await new WagerTransactionRepository(
      orm.em.fork(),
    ).findById(transactionId);

    const storedLedger = await new WalletLedgerEntryRepository(
      orm.em.fork(),
    ).findByTransactionId(transactionId);

    const outboxRecords = await orm.em.fork()
      .getConnection()
      .execute<{ id: string }[]>(
        `select id
         from outbox_messages
         where aggregate_id = ?
            or payload->'data'->>'transactionId' = ?`,
        [transactionId, transactionId],
      );

    expect(storedInbox?.isProcessed()).toBe(true);
    expect(storedWallet?.balance.toString()).toBe('50.00');
    expect(storedWallet?.version).toBe(2);
    expect(storedTransaction?.status).toBe(
      WagerTransactionStatus.Processed,
    );
    expect(storedLedger?.isBalanced()).toBe(true);
    expect(outboxRecords.length).toBe(2);
  });

  it('should roll back inbox and financial changes together', async () => {
    const walletId = crypto.randomUUID();
    const playerId = `player-${walletId}`;
    const messageId = crypto.randomUUID();
    const transactionId = crypto.randomUUID();
    const consumerName = 'wagering-consumer';

    const wallet = Wallet.open({
      id: walletId,
      playerId,
      initialBalance: Money.create('0', 'BRL'),
    });

    await new WalletRepository(orm.em.fork()).save(wallet);

    const input: ProcessWagerTransactionInput = {
      transactionId,
      walletId,
      playerId,
      providerId: 'inbox-integration-provider',
      externalTransactionId: crypto.randomUUID(),
      idempotencyKey: `inbox:${crypto.randomUUID()}`,
      payloadHash: 'financial-payload-hash',
      roundId: 'round-inbox',
      gameId: 'game-inbox',
      kind: WagerTransactionKind.Win,
      amount: '50.00',
      currency: 'BRL',
      correlationId: crypto.randomUUID(),
    };

    await expect(
      orm.em.fork().transactional(async (em) => {
        const inboxRepository = new InboxMessageRepository(em);
        const useCase = new ProcessWagerTransactionUseCase(em);

        const message = InboxMessage.receive({
          messageId,
          consumerName,
          payloadHash: 'message-payload-hash',
        });

        await inboxRepository.save(message);

        const result = await useCase.execute(input, em);

        expect(result.balance).toBe('50.00');

        message.markProcessed();
        await inboxRepository.save(message);

        throw new Error('Forced rollback');
      }),
    ).rejects.toThrow('Forced rollback');

    const storedInbox = await new InboxMessageRepository(
      orm.em.fork(),
    ).findById(consumerName, messageId);

    const storedWallet = await new WalletRepository(
      orm.em.fork(),
    ).findById(walletId);

    const storedTransaction = await new WagerTransactionRepository(
      orm.em.fork(),
    ).findById(transactionId);

    const storedLedger = await new WalletLedgerEntryRepository(
      orm.em.fork(),
    ).findByTransactionId(transactionId);

    const outboxRecords = await orm.em.fork()
      .getConnection()
      .execute<{ id: string }[]>(
        `select id
         from outbox_messages
         where aggregate_id = ?
            or payload->'data'->>'transactionId' = ?`,
        [transactionId, transactionId],
      );

    expect(storedInbox).toBeNull();
    expect(storedWallet?.balance.toString()).toBe('0.00');
    expect(storedWallet?.version).toBe(1);
    expect(storedTransaction).toBeNull();
    expect(storedLedger).toBeNull();
    expect(outboxRecords.length).toBe(0);
  });

  it('should prevent concurrent processing of the same inbox message', async () => {
    const walletId = crypto.randomUUID();
    const playerId = `player-${walletId}`;
    const messageId = crypto.randomUUID();
    const transactionId = crypto.randomUUID();
    const consumerName = 'wagering-consumer';

    await new WalletRepository(orm.em.fork()).save(
      Wallet.open({
        id: walletId,
        playerId,
        initialBalance: Money.create('0', 'BRL'),
      }),
    );

    const input: ProcessWagerTransactionInput = {
      transactionId,
      walletId,
      playerId,
      providerId: 'inbox-concurrency-provider',
      externalTransactionId: crypto.randomUUID(),
      idempotencyKey: `inbox:${crypto.randomUUID()}`,
      payloadHash: 'concurrent-financial-hash',
      roundId: 'round-concurrency',
      gameId: 'game-concurrency',
      kind: WagerTransactionKind.Win,
      amount: '50.00',
      currency: 'BRL',
      correlationId: crypto.randomUUID(),
    };

    async function processMessage(): Promise<void> {
      await orm.em.fork().transactional(async (em) => {
        const inbox = new InboxMessageRepository(em);
        const useCase = new ProcessWagerTransactionUseCase(em);

        const existing = await inbox.findById(
          consumerName,
          messageId,
        );

        if (existing?.isProcessed()) {
          return;
        }

        const message = InboxMessage.receive({
          messageId,
          consumerName,
          payloadHash: 'concurrent-message-hash',
        });

        await inbox.save(message);
        await useCase.execute(input, em);

        message.markProcessed();
        await inbox.save(message);
      });
    }

    const results = await Promise.allSettled([
      processMessage(),
      processMessage(),
    ]);

    const successful = results.filter(
      (result) => result.status === 'fulfilled',
    );

    const failed = results.filter(
      (result) => result.status === 'rejected',
    );

    expect(successful.length).toBe(1);
    expect(failed.length).toBe(1);

    const storedWallet = await new WalletRepository(
      orm.em.fork(),
    ).findById(walletId);

    const storedInbox = await new InboxMessageRepository(
      orm.em.fork(),
    ).findById(consumerName, messageId);

    const storedTransaction = await new WagerTransactionRepository(
      orm.em.fork(),
    ).findById(transactionId);

    const storedLedger = await new WalletLedgerEntryRepository(
      orm.em.fork(),
    ).findByTransactionId(transactionId);

    const records = await orm.em.fork()
      .getConnection()
      .execute<{ count: string }[]>(
        `select count(*) as count
         from inbox_messages
         where consumer_name = ?
           and message_id = ?`,
        [consumerName, messageId],
      );

    expect(storedWallet?.balance.toString()).toBe('50.00');
    expect(storedWallet?.version).toBe(2);
    expect(storedInbox?.isProcessed()).toBe(true);
    expect(storedTransaction?.status).toBe(
      WagerTransactionStatus.Processed,
    );
    expect(storedLedger?.isBalanced()).toBe(true);
    expect(Number(records[0]?.count)).toBe(1);
  });
});
