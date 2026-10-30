import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';

import ormConfig from '../src/mikro-orm.config.js';
import { Money } from '../src/domain/value-objects/money.js';
import { Wallet } from '../src/domain/entities/wallet.js';
import {
  WagerTransactionKind,
} from '../src/domain/entities/wager-transaction.js';
import {
  WalletRepository,
} from '../src/infrastructure/persistence/wallet.repository.js';
import {
  PendingReferenceRepository,
} from '../src/infrastructure/persistence/pending-reference.repository.js';
import {
  ProcessWagerTransactionUseCase,
  type ProcessWagerTransactionInput,
} from '../src/application/use-cases/process-wager-transaction.use-case.js';

describe('PendingReferenceRepository integration', () => {
  let orm: MikroORM;

  let walletId: string;
  let playerId: string;
  let transactionId: string;

  const baseDate = new Date('2026-10-29T15:00:00.000Z');

  beforeAll(async () => {
    orm = await MikroORM.init(ormConfig);

    walletId = crypto.randomUUID();
    playerId = `player-${walletId}`;
    transactionId = crypto.randomUUID();

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
      providerId: 'pending-reference-test',
      externalTransactionId: transactionId,
      idempotencyKey: `pending:${transactionId}`,
      payloadHash: `hash:${transactionId}`,
      roundId: 'round-test',
      gameId: 'game-test',
      kind: WagerTransactionKind.Refund,
      amount: '25.00',
      currency: 'BRL',
      referenceExternalTransactionId:
        `missing-${transactionId}`,
      correlationId: crypto.randomUUID(),
    };

    const useCase = new ProcessWagerTransactionUseCase(
      orm.em,
    );

    const result = await useCase.execute(input);

    expect(result.status).toBe('PENDING_REFERENCE');
  });

  afterAll(async () => {
    if (orm) {
      await orm.close();
    }
  });

  it('should find pending references when their schedule is due', async () => {
    const repository = new PendingReferenceRepository(
      orm.em.fork(),
    );

    const dueIds = await repository.findDueIds(
      new Date(Date.now() + 60_000),
    );

    expect(dueIds).toContain(transactionId);
  });

  it('should exclude pending references scheduled in the future', async () => {
    const repository = new PendingReferenceRepository(
      orm.em.fork(),
    );

    const dueIds = await repository.findDueIds(baseDate);

    expect(dueIds).not.toContain(transactionId);
  });

  it('should lock and reload the transaction inside a SQL transaction', async () => {
    await orm.em.fork().transactional(async (em) => {
      const walletRepository = new WalletRepository(em);

      const wallet = await walletRepository.findByIdForUpdate(
        walletId,
      );

      expect(wallet).not.toBeNull();

      const pendingRepository = new PendingReferenceRepository(em);

      const record = await pendingRepository.findByIdForUpdate(
        transactionId,
      );

      expect(record).not.toBeNull();
      expect(record?.status).toBe('PENDING_REFERENCE');
      expect(record?.referenceAttempts).toBe(0);
      expect(record?.nextReferenceAttemptAt).toBeDefined();
    });
  });

  it('should reject invalid query limits', async () => {
    const repository = new PendingReferenceRepository(
      orm.em.fork(),
    );

    await expect(
      repository.findDueIds(new Date(), 0),
    ).rejects.toThrow('Invalid reference query limit');
  });
});
