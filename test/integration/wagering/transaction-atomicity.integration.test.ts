import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';
import { randomUUID } from 'node:crypto';
import { MikroORM } from '@mikro-orm/postgresql';

import ormConfig from '../../../src/mikro-orm.config.js';
import { Wallet } from '../../../src/domain/entities/wallet.js';
import { Money } from '../../../src/domain/value-objects/money.js';
import { WagerTransactionKind } from '../../../src/domain/entities/wager-transaction.js';
import { InboxMessage } from '../../../src/domain/entities/inbox-message.js';
import { WalletRepository } from '../../../src/infrastructure/persistence/repository/wallet.repository.js';
import { InboxMessageRepository } from '../../../src/infrastructure/persistence/repository/inbox-message.repository.js';
import { ProcessWagerTransactionUseCase } from '../../../src/application/use-cases/wagering/process-wager-transaction.use-case.js';

describe('Transaction atomicity integration', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init(ormConfig);
  });

  afterAll(async () => {
    if (orm) {
      await orm.close();
    }
  });

  it('should rollback wallet, transaction, ledger, inbox and outbox after a failure', async () => {
    const walletId = randomUUID();
    const playerId = `player-${walletId}`;
    const transactionId = randomUUID();
    const messageId = randomUUID();
    const consumerName = 'atomicity-test-consumer';

    const wallet = Wallet.open({
      id: walletId,
      playerId,
      initialBalance: Money.create('0.00', 'BRL'),
    });

    await new WalletRepository(orm.em.fork()).save(wallet);

    const before = await new WalletRepository(
      orm.em.fork(),
    ).findById(walletId);

    expect(before).not.toBeNull();

    const initialBalance = before!.balance.toString();
    const initialVersion = before!.version;

    await expect(
      orm.em.fork().transactional(async (em) => {
        const inbox = new InboxMessageRepository(em);

        const message = InboxMessage.receive({
          messageId,
          consumerName,
          payloadHash: `hash:${transactionId}`,
        });

        const claimed = await inbox.claim(message);

        const useCase = new ProcessWagerTransactionUseCase(em);

        await useCase.execute(
          {
            transactionId,
            walletId,
            playerId,
            providerId: 'atomicity-test-provider',
            externalTransactionId: transactionId,
            idempotencyKey: `atomicity:${transactionId}`,
            payloadHash: `hash:${transactionId}`,
            roundId: 'atomicity-round',
            gameId: 'atomicity-game',
            kind: WagerTransactionKind.Win,
            amount: '50.00',
            currency: 'BRL',
            correlationId: messageId,
          },
          em,
        );

        claimed.markProcessed();
        await inbox.save(claimed);

        const walletDuringTransaction = await em.execute<
          { balance: string }[]
        >(
          'SELECT balance FROM wallets WHERE id = ?::uuid',
          [walletId],
        );

        const transactionDuringTransaction = await em.execute<
          { id: string }[]
        >(
          'SELECT id FROM wager_transactions WHERE id = ?::uuid',
          [transactionId],
        );

        const ledgerDuringTransaction = await em.execute<
          { id: string }[]
        >(
          'SELECT id FROM wallet_ledger_entries WHERE transaction_id = ?::uuid',
          [transactionId],
        );

        const outboxDuringTransaction = await em.execute<
          { id: string }[]
        >(
          'SELECT id FROM outbox_messages WHERE aggregate_id = ? OR aggregate_id = ?',
          [transactionId, walletId],
        );

        expect(walletDuringTransaction[0]?.balance).toBe('50.00');
        expect(transactionDuringTransaction).toHaveLength(1);
        expect(ledgerDuringTransaction).toHaveLength(1);
        expect(outboxDuringTransaction).toHaveLength(2);

        throw new Error('SIMULATED_TRANSACTION_FAILURE');
      }),
    ).rejects.toThrow('SIMULATED_TRANSACTION_FAILURE');

    const after = await new WalletRepository(
      orm.em.fork(),
    ).findById(walletId);

    expect(after).not.toBeNull();
    expect(after!.balance.toString()).toBe(initialBalance);
    expect(after!.version).toBe(initialVersion);

    const transactionRows = await orm.em.fork().execute<
      { id: string }[]
    >(
      'SELECT id FROM wager_transactions WHERE id = ?::uuid',
      [transactionId],
    );

    const ledgerRows = await orm.em.fork().execute<
      { id: string }[]
    >(
      'SELECT id FROM wallet_ledger_entries WHERE transaction_id = ?::uuid',
      [transactionId],
    );

    const inboxRows = await orm.em.fork().execute<
      { message_id: string }[]
    >(
      'SELECT message_id FROM inbox_messages WHERE message_id = ?',
      [messageId],
    );

    const outboxRows = await orm.em.fork().execute<
      { id: string }[]
    >(
      'SELECT id FROM outbox_messages WHERE aggregate_id = ? OR aggregate_id = ?',
      [transactionId, walletId],
    );

    expect(transactionRows).toHaveLength(0);
    expect(ledgerRows).toHaveLength(0);
    expect(inboxRows).toHaveLength(0);
    expect(outboxRows).toHaveLength(0);
  });
});