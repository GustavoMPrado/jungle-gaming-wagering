import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';

import ormConfig from '../../../src/mikro-orm.config.js';
import { Money } from '../../../src/domain/value-objects/money.js';
import { Wallet } from '../../../src/domain/entities/wallet.js';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../src/domain/entities/wager-transaction.js';
import {
  LedgerDirection,
} from '../../../src/domain/entities/wallet-ledger-entry.js';
import { WalletRepository } from '../../../src/infrastructure/persistence/repository/wallet.repository.js';
import { WagerTransactionRepository } from '../../../src/infrastructure/persistence/repository/wager-transaction.repository.js';
import { WalletLedgerEntryRepository } from '../../../src/infrastructure/persistence/repository/wallet-ledger-entry.repository.js';
import {
  ProcessWagerTransactionUseCase,
  type ProcessWagerTransactionInput,
} from '../../../src/application/use-cases/wagering/process-wager-transaction.use-case.js';
import {
  PendingReferenceWorker,
} from '../../../src/application/workers/pending-reference.worker.js';

describe('PendingReferenceWorker runOnce integration', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init(ormConfig);
  });

  afterAll(async () => {
    if (orm) {
      await orm.close();
    }
  });

  async function createWallet() {
    const walletId = crypto.randomUUID();
    const playerId = `player-${walletId}`;

    await new WalletRepository(orm.em.fork()).save(
      Wallet.open({
        id: walletId,
        playerId,
        initialBalance: Money.create('0', 'BRL'),
      }),
    );

    return { walletId, playerId };
  }

  function createInput(
    walletId: string,
    playerId: string,
    kind: WagerTransactionKind,
    amount: string,
    externalTransactionId = crypto.randomUUID(),
  ): ProcessWagerTransactionInput {
    const transactionId = crypto.randomUUID();

    return {
      transactionId,
      walletId,
      playerId,
      providerId: 'run-once-integration-provider',
      externalTransactionId,
      idempotencyKey: `run-once:${transactionId}`,
      payloadHash: `hash:${transactionId}`,
      roundId: 'round-1',
      gameId: 'game-1',
      kind,
      amount,
      currency: 'BRL',
      correlationId: crypto.randomUUID(),
    };
  }

  async function findTransaction(transactionId: string) {
    return new WagerTransactionRepository(
      orm.em.fork(),
    ).findById(transactionId);
  }

  it('should process a pending refund when the BET becomes available', async () => {
    const { walletId, playerId } = await createWallet();
    const useCase = new ProcessWagerTransactionUseCase(orm.em);

    await useCase.execute(
      createInput(
        walletId,
        playerId,
        WagerTransactionKind.Win,
        '100.00',
      ),
    );

    const betExternalId = crypto.randomUUID();

    const refund = {
      ...createInput(
        walletId,
        playerId,
        WagerTransactionKind.Refund,
        '30.00',
      ),
      referenceExternalTransactionId: betExternalId,
    };

    const pending = await useCase.execute(refund);

    expect(pending.status).toBe(
      WagerTransactionStatus.PendingReference,
    );

    await useCase.execute(
      createInput(
        walletId,
        playerId,
        WagerTransactionKind.Bet,
        '30.00',
        betExternalId,
      ),
    );

    const stored = await findTransaction(refund.transactionId);
    const due = stored!.nextReferenceAttemptAt!;

    const worker = new PendingReferenceWorker(orm.em);
    const results = await worker.runOnce(due, 1000);

    expect(
      results.some(
        (result) =>
          result.transactionId === refund.transactionId &&
          result.status === WagerTransactionStatus.Processed,
      ),
    ).toBe(true);

    const updated = await findTransaction(refund.transactionId);

    expect(updated?.status).toBe(
      WagerTransactionStatus.Processed,
    );

    const wallet = await new WalletRepository(
      orm.em.fork(),
    ).findById(walletId);

    expect(wallet?.balance.toString()).toBe('100.00');

    const ledger = await new WalletLedgerEntryRepository(
      orm.em.fork(),
    ).findByTransactionId(refund.transactionId);

    expect(ledger?.direction).toBe(LedgerDirection.Credit);
    expect(ledger?.isBalanced()).toBe(true);
  });

  it('should not retry a transaction before its scheduled time', async () => {
    const { walletId, playerId } = await createWallet();
    const useCase = new ProcessWagerTransactionUseCase(orm.em);

    const refund = {
      ...createInput(
        walletId,
        playerId,
        WagerTransactionKind.Refund,
        '15.00',
      ),
      referenceExternalTransactionId:
        `missing-${crypto.randomUUID()}`,
    };

    await useCase.execute(refund);

    const stored = await findTransaction(refund.transactionId);

    const beforeDue = new Date(
      stored!.nextReferenceAttemptAt!.getTime() - 1,
    );

    const worker = new PendingReferenceWorker(orm.em);
    const results = await worker.runOnce(beforeDue, 1000);

    expect(
      results.some(
        (result) =>
          result.transactionId === refund.transactionId,
      ),
    ).toBe(false);

    const unchanged = await findTransaction(
      refund.transactionId,
    );

    expect(unchanged?.status).toBe(
      WagerTransactionStatus.PendingReference,
    );
    expect(unchanged?.referenceAttempts).toBe(0);
  });

  it('should not count the same retry twice with two workers', async () => {
    const { walletId, playerId } = await createWallet();
    const useCase = new ProcessWagerTransactionUseCase(orm.em);

    const refund = {
      ...createInput(
        walletId,
        playerId,
        WagerTransactionKind.Refund,
        '20.00',
      ),
      referenceExternalTransactionId:
        `missing-${crypto.randomUUID()}`,
    };

    await useCase.execute(refund);

    const stored = await findTransaction(refund.transactionId);
    const due = stored!.nextReferenceAttemptAt!;

    const firstWorker = new PendingReferenceWorker(
      orm.em.fork(),
    );

    const secondWorker = new PendingReferenceWorker(
      orm.em.fork(),
    );

    const [firstResults, secondResults] = await Promise.all([
      firstWorker.runOnce(due, 1000),
      secondWorker.runOnce(due, 1000),
    ]);

    const occurrences = [
      ...firstResults,
      ...secondResults,
    ].filter(
      (result) =>
        result.transactionId === refund.transactionId,
    );

    expect(occurrences.length).toBe(1);

    const updated = await findTransaction(
      refund.transactionId,
    );

    expect(updated?.status).toBe(
      WagerTransactionStatus.PendingReference,
    );

    expect(updated?.referenceAttempts).toBe(1);

    expect(
      updated!.nextReferenceAttemptAt!.getTime(),
    ).toBeGreaterThan(due.getTime());
  });
});
