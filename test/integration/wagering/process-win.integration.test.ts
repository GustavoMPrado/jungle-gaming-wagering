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
import {
  WagerTransactionStatus,
} from '../../../src/domain/entities/wager-transaction.js';
import {
  LedgerDirection,
} from '../../../src/domain/entities/wallet-ledger-entry.js';
import {
  WalletRepository,
} from '../../../src/infrastructure/persistence/repository/wallet.repository.js';
import {
  WagerTransactionRepository,
} from '../../../src/infrastructure/persistence/repository/wager-transaction.repository.js';
import {
  WalletLedgerEntryRepository,
} from '../../../src/infrastructure/persistence/repository/wallet-ledger-entry.repository.js';
import {
  OutboxMessageRepository,
} from '../../../src/infrastructure/persistence/repository/outbox-message.repository.js';
import {
  ProcessWinUseCase,
  type ProcessWinInput,
} from '../../../src/application/use-cases/wagering/process-win.use-case.js';

describe('ProcessWinUseCase integration', () => {
  let orm: MikroORM;
  let walletId: string;
  let playerId: string;
  let input: ProcessWinInput;

  beforeAll(async () => {
    orm = await MikroORM.init(ormConfig);

    walletId = crypto.randomUUID();
    playerId = `player-${walletId}`;

    input = {
      transactionId: crypto.randomUUID(),
      ledgerId: crypto.randomUUID(),
      processedEventId: crypto.randomUUID(),
      balanceEventId: crypto.randomUUID(),
      walletId,
      playerId,
      providerId: 'integration-provider',
      externalTransactionId: crypto.randomUUID(),
      idempotencyKey: `win:${crypto.randomUUID()}`,
      payloadHash: 'integration-win-hash',
      roundId: 'round-integration',
      gameId: 'game-integration',
      amount: '25.00',
      currency: 'BRL',
      correlationId: crypto.randomUUID(),
    };

    const wallet = Wallet.open({
      id: walletId,
      playerId,
      initialBalance: Money.create('0', 'BRL'),
    });

    await new WalletRepository(orm.em.fork()).save(wallet);
  });

  afterAll(async () => {
    if (orm) {
      await orm.close();
    }
  });

  it('should commit wallet, transaction, ledger and outbox', async () => {
    const useCase = new ProcessWinUseCase(orm.em);

    const result = await useCase.execute(input);

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance).toBe('25.00');
    expect(result.idempotentReplay).toBe(false);

    const wallets = new WalletRepository(orm.em.fork());
    const transactions = new WagerTransactionRepository(
      orm.em.fork(),
    );
    const entries = new WalletLedgerEntryRepository(
      orm.em.fork(),
    );
    const outbox = new OutboxMessageRepository(
      orm.em.fork(),
    );

    const wallet = await wallets.findById(walletId);
    const transaction = await transactions.findById(
      input.transactionId,
    );
    const ledger = await entries.findByTransactionId(
      input.transactionId,
    );
    const processedEvent = await outbox.findById(
      input.processedEventId,
    );
    const balanceEvent = await outbox.findById(
      input.balanceEventId,
    );

    expect(wallet?.balance.toString()).toBe('25.00');
    expect(wallet?.version).toBe(2);
    expect(transaction?.status).toBe(
      WagerTransactionStatus.Processed,
    );
    expect(ledger?.direction).toBe(LedgerDirection.Credit);
    expect(ledger?.isBalanced()).toBe(true);
    expect(processedEvent?.eventType).toBe(
      'WagerTransactionProcessed',
    );
    expect(balanceEvent?.eventType).toBe(
      'WalletBalanceChanged',
    );
    expect(processedEvent?.isPending()).toBe(true);
    expect(balanceEvent?.isPending()).toBe(true);
  });

  it('should replay the original result without another credit', async () => {
    const useCase = new ProcessWinUseCase(orm.em);

    const result = await useCase.execute(input);

    expect(result.transactionId).toBe(input.transactionId);
    expect(result.balance).toBe('25.00');
    expect(result.idempotentReplay).toBe(true);

    const wallet = await new WalletRepository(
      orm.em.fork(),
    ).findById(walletId);

    expect(wallet?.balance.toString()).toBe('25.00');
    expect(wallet?.version).toBe(2);
  });

  it('should reject a changed payload for the same key', async () => {
    const useCase = new ProcessWinUseCase(orm.em);

    await expect(
      useCase.execute({
        ...input,
        payloadHash: 'different-hash',
      }),
    ).rejects.toThrow('Idempotency conflict');

    const wallet = await new WalletRepository(
      orm.em.fork(),
    ).findById(walletId);

    expect(wallet?.balance.toString()).toBe('25.00');
  });

  it('should roll back all changes if outbox insertion fails', async () => {
    const useCase = new ProcessWinUseCase(orm.em);

    const failedTransactionId = crypto.randomUUID();

    await expect(
      useCase.execute({
        ...input,
        transactionId: failedTransactionId,
        ledgerId: crypto.randomUUID(),
        externalTransactionId: crypto.randomUUID(),
        idempotencyKey: `win:${crypto.randomUUID()}`,
        payloadHash: 'another-win-hash',
        processedEventId: input.processedEventId,
        balanceEventId: crypto.randomUUID(),
      }),
    ).rejects.toThrow();

    const wallet = await new WalletRepository(
      orm.em.fork(),
    ).findById(walletId);

    const failedTransaction = await new WagerTransactionRepository(
      orm.em.fork(),
    ).findById(failedTransactionId);

    expect(wallet?.balance.toString()).toBe('25.00');
    expect(failedTransaction).toBeNull();
  });
});
