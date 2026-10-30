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
import { PendingReferenceWorker } from '../../../src/application/workers/pending-reference.worker.js';

describe('PendingReferenceWorker integration', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init(ormConfig);
  });

  afterAll(async () => {
    if (orm) {
      await orm.close();
    }
  });

  async function createWallet(): Promise<{
    walletId: string;
    playerId: string;
  }> {
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
    externalTransactionId: string = crypto.randomUUID(),
  ): ProcessWagerTransactionInput {
    return {
      transactionId: crypto.randomUUID(),
      walletId,
      playerId,
      providerId: 'worker-integration-provider',
      externalTransactionId,
      idempotencyKey: `worker:${crypto.randomUUID()}`,
      payloadHash: `hash:${crypto.randomUUID()}`,
      roundId: 'round-1',
      gameId: 'game-1',
      kind,
      amount,
      currency: 'BRL',
      correlationId: crypto.randomUUID(),
    };
  }

  async function getTransaction(id: string) {
    return new WagerTransactionRepository(
      orm.em.fork(),
    ).findById(id);
  }

  it('should process a refund after its BET arrives', async () => {
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

    const bet = createInput(
      walletId,
      playerId,
      WagerTransactionKind.Bet,
      '30.00',
      betExternalId,
    );

    await useCase.execute(bet);

    const beforeRetry = await getTransaction(
      refund.transactionId,
    );

    const due = beforeRetry!.nextReferenceAttemptAt!;

    const result = await useCase.resumePendingReference(
      refund.transactionId,
      due,
    );

    expect(result?.status).toBe(
      WagerTransactionStatus.Processed,
    );

    const stored = await getTransaction(refund.transactionId);

    expect(stored?.referenceTransactionId).toBe(
      bet.transactionId,
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

  it('should reject a missing reference after ten retries', async () => {
    const { walletId, playerId } = await createWallet();
    const useCase = new ProcessWagerTransactionUseCase(orm.em);

    const refund = {
      ...createInput(
        walletId,
        playerId,
        WagerTransactionKind.Refund,
        '25.00',
      ),
      referenceExternalTransactionId:
        `missing-${crypto.randomUUID()}`,
    };

    await useCase.execute(refund);

    for (let attempt = 1; attempt <= 10; attempt++) {
      const stored = await getTransaction(
        refund.transactionId,
      );

      const due = stored!.nextReferenceAttemptAt!;

      const result = await useCase.resumePendingReference(
        refund.transactionId,
        due,
      );

      expect(result?.status).toBe(
        attempt === 10
          ? WagerTransactionStatus.Rejected
          : WagerTransactionStatus.PendingReference,
      );
    }

    const stored = await getTransaction(refund.transactionId);

    expect(stored?.referenceAttempts).toBe(10);
    expect(stored?.failureCode).toBe(
      'REFERENCE_NOT_FOUND',
    );
    expect(stored?.nextReferenceAttemptAt).toBeUndefined();

    const duplicate = await useCase.resumePendingReference(
      refund.transactionId,
      new Date(Date.now() + 600_000),
    );

    expect(duplicate).toBeNull();
  });

  it('should not retry before the scheduled time', async () => {
    const { walletId, playerId } = await createWallet();
    const useCase = new ProcessWagerTransactionUseCase(orm.em);

    const refund = {
      ...createInput(
        walletId,
        playerId,
        WagerTransactionKind.Refund,
        '25.00',
      ),
      referenceExternalTransactionId:
        `missing-${crypto.randomUUID()}`,
    };

    await useCase.execute(refund);

    const stored = await getTransaction(refund.transactionId);

    const beforeDue = new Date(
      stored!.nextReferenceAttemptAt!.getTime() - 1,
    );

    const result = await useCase.resumePendingReference(
      refund.transactionId,
      beforeDue,
    );

    expect(result).toBeNull();

    const unchanged = await getTransaction(
      refund.transactionId,
    );

    expect(unchanged?.referenceAttempts).toBe(0);
  });

  it('should reject a reference that was rejected', async () => {
    const { walletId, playerId } = await createWallet();
    const useCase = new ProcessWagerTransactionUseCase(orm.em);

    const betExternalId = crypto.randomUUID();

    const refund = {
      ...createInput(
        walletId,
        playerId,
        WagerTransactionKind.Refund,
        '50.00',
      ),
      referenceExternalTransactionId: betExternalId,
    };

    await useCase.execute(refund);

    const bet = createInput(
      walletId,
      playerId,
      WagerTransactionKind.Bet,
      '50.00',
      betExternalId,
    );

    const rejectedBet = await useCase.execute(bet);

    expect(rejectedBet.status).toBe(
      WagerTransactionStatus.Rejected,
    );

    const stored = await getTransaction(refund.transactionId);

    const result = await useCase.resumePendingReference(
      refund.transactionId,
      stored!.nextReferenceAttemptAt!,
    );

    expect(result?.status).toBe(
      WagerTransactionStatus.Rejected,
    );
    expect(result?.failureCode).toBe(
      'INVALID_REFERENCE_STATUS',
    );
  });

  it('should skip a transaction already processed by another worker', async () => {
    const { walletId, playerId } = await createWallet();
    const useCase = new ProcessWagerTransactionUseCase(orm.em);

    const refund = {
      ...createInput(
        walletId,
        playerId,
        WagerTransactionKind.Refund,
        '10.00',
      ),
      referenceExternalTransactionId:
        `missing-${crypto.randomUUID()}`,
    };

    await useCase.execute(refund);

    const stored = await getTransaction(refund.transactionId);
    const due = stored!.nextReferenceAttemptAt!;

    await useCase.resumePendingReference(
      refund.transactionId,
      due,
    );

    const repeated = await useCase.resumePendingReference(
      refund.transactionId,
      due,
    );

    expect(repeated).toBeNull();
  });
});
