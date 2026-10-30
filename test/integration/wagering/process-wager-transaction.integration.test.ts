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
import { WalletRepository } from '../../../src/infrastructure/persistence/repository/wallet.repository.js';
import { WagerTransactionRepository } from '../../../src/infrastructure/persistence/repository/wager-transaction.repository.js';
import { WalletLedgerEntryRepository } from '../../../src/infrastructure/persistence/repository/wallet-ledger-entry.repository.js';
import {
  ProcessWagerTransactionUseCase,
  type ProcessWagerTransactionInput,
} from '../../../src/application/use-cases/wagering/process-wager-transaction.use-case.js';

describe('ProcessWagerTransaction integration', () => {
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

    const wallet = Wallet.open({
      id: walletId,
      playerId,
      initialBalance: Money.create('0', 'BRL'),
    });

    await new WalletRepository(orm.em.fork()).save(wallet);

    return { walletId, playerId };
  }

  function createInput(
    walletId: string,
    playerId: string,
    kind: WagerTransactionKind,
    amount: string,
  ): ProcessWagerTransactionInput {
    const transactionId = crypto.randomUUID();

    return {
      transactionId,
      walletId,
      playerId,
      providerId: 'integration-provider',
      externalTransactionId: transactionId,
      idempotencyKey: `integration:${transactionId}`,
      payloadHash: `hash:${transactionId}`,
      roundId: 'round-1',
      gameId: 'game-1',
      kind,
      amount,
      currency: 'BRL',
      correlationId: crypto.randomUUID(),
    };
  }

  it('should process WIN and BET with the correct balance', async () => {
    const { walletId, playerId } = await createWallet();
    const useCase = new ProcessWagerTransactionUseCase(orm.em);

    const win = await useCase.execute(
      createInput(
        walletId,
        playerId,
        WagerTransactionKind.Win,
        '100.00',
      ),
    );

    const bet = await useCase.execute(
      createInput(
        walletId,
        playerId,
        WagerTransactionKind.Bet,
        '30.00',
      ),
    );

    expect(win.status).toBe(WagerTransactionStatus.Processed);
    expect(win.balance).toBe('100.00');
    expect(bet.status).toBe(WagerTransactionStatus.Processed);
    expect(bet.balance).toBe('70.00');

    const wallet = await new WalletRepository(
      orm.em.fork(),
    ).findById(walletId);

    const entries = await new WalletLedgerEntryRepository(
      orm.em.fork(),
    ).findByWalletId(walletId);

    expect(wallet?.balance.toString()).toBe('70.00');
    expect(wallet?.version).toBe(3);
    expect(entries.length).toBe(2);
    expect(entries.every((entry) => entry.isBalanced())).toBe(true);
  });

  it('should reject BET without sufficient balance', async () => {
    const { walletId, playerId } = await createWallet();
    const useCase = new ProcessWagerTransactionUseCase(orm.em);

    const input = createInput(
      walletId,
      playerId,
      WagerTransactionKind.Bet,
      '80.00',
    );

    const result = await useCase.execute(input);

    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(result.failureCode).toBe('INSUFFICIENT_BALANCE');
    expect(result.balance).toBe('0.00');

    const ledger = await new WalletLedgerEntryRepository(
      orm.em.fork(),
    ).findByTransactionId(input.transactionId);

    expect(ledger).toBeNull();
  });

  it('should process LOSS without changing the balance', async () => {
    const { walletId, playerId } = await createWallet();
    const useCase = new ProcessWagerTransactionUseCase(orm.em);

    const input = createInput(
      walletId,
      playerId,
      WagerTransactionKind.Loss,
      '15.00',
    );

    const result = await useCase.execute(input);

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance).toBe('0.00');

    const wallet = await new WalletRepository(
      orm.em.fork(),
    ).findById(walletId);

    const ledger = await new WalletLedgerEntryRepository(
      orm.em.fork(),
    ).findByTransactionId(input.transactionId);

    expect(wallet?.version).toBe(1);
    expect(ledger).toBeNull();
  });

  it('should process REFUND of a processed BET', async () => {
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

    const betInput = createInput(
      walletId,
      playerId,
      WagerTransactionKind.Bet,
      '30.00',
    );

    await useCase.execute(betInput);

    const refundInput = {
      ...createInput(
        walletId,
        playerId,
        WagerTransactionKind.Refund,
        '30.00',
      ),
      referenceExternalTransactionId:
        betInput.externalTransactionId,
    };

    const result = await useCase.execute(refundInput);

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance).toBe('100.00');

    const refund = await new WagerTransactionRepository(
      orm.em.fork(),
    ).findById(refundInput.transactionId);

    expect(refund?.referenceTransactionId).toBe(
      betInput.transactionId,
    );
  });

  it('should process ROLLBACK of a processed WIN', async () => {
    const { walletId, playerId } = await createWallet();
    const useCase = new ProcessWagerTransactionUseCase(orm.em);

    const winInput = createInput(
      walletId,
      playerId,
      WagerTransactionKind.Win,
      '50.00',
    );

    await useCase.execute(winInput);

    const rollbackInput = {
      ...createInput(
        walletId,
        playerId,
        WagerTransactionKind.Rollback,
        '50.00',
      ),
      referenceExternalTransactionId:
        winInput.externalTransactionId,
    };

    const result = await useCase.execute(rollbackInput);

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance).toBe('0.00');
  });

  it('should persist a missing reversal as PENDING_REFERENCE', async () => {
    const { walletId, playerId } = await createWallet();
    const useCase = new ProcessWagerTransactionUseCase(orm.em);

    const input = {
      ...createInput(
        walletId,
        playerId,
        WagerTransactionKind.Refund,
        '25.00',
      ),
      referenceExternalTransactionId: 'missing-bet',
    };

    const result = await useCase.execute(input);

    expect(result.status).toBe(
      WagerTransactionStatus.PendingReference,
    );

    const stored = await new WagerTransactionRepository(
      orm.em.fork(),
    ).findById(input.transactionId);

    expect(stored?.referenceAttempts).toBe(0);
    expect(stored?.nextReferenceAttemptAt).toBeDefined();
  });

  it('should replay without applying the same BET twice', async () => {
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

    const betInput = createInput(
      walletId,
      playerId,
      WagerTransactionKind.Bet,
      '40.00',
    );

    const first = await useCase.execute(betInput);
    const replay = await useCase.execute(betInput);

    expect(first.balance).toBe('60.00');
    expect(replay.balance).toBe('60.00');
    expect(replay.idempotentReplay).toBe(true);

    const entries = await new WalletLedgerEntryRepository(
      orm.em.fork(),
    ).findByWalletId(walletId);

    expect(entries.length).toBe(2);
  });
});
