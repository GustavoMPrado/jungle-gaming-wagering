import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';

import ormConfig from '../../../src/mikro-orm.config.js';
import { CreateWalletUseCase } from '../../../src/application/use-cases/wallet/create-wallet.use-case.js';
import {
  ProcessWagerTransactionUseCase,
  type ProcessWagerTransactionInput,
} from '../../../src/application/use-cases/wagering/process-wager-transaction.use-case.js';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../src/domain/entities/wager-transaction.js';
import { WalletRepository } from '../../../src/infrastructure/persistence/repository/wallet.repository.js';
import { WalletLedgerEntryRepository } from '../../../src/infrastructure/persistence/repository/wallet-ledger-entry.repository.js';

describe('Wager concurrency integration', () => {
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
    const useCase = new CreateWalletUseCase(orm.em);

    return useCase.execute({
      playerId: `player-${crypto.randomUUID()}`,
      currency: 'BRL',
      initialBalance: '100.00',
    });
  }

  function createBet(
    walletId: string,
    playerId: string,
    amount = '20.00',
  ): ProcessWagerTransactionInput {
    const id = crypto.randomUUID();

    return {
      transactionId: id,
      walletId,
      playerId,
      providerId: 'concurrency-provider',
      externalTransactionId: id,
      idempotencyKey: `concurrency:${id}`,
      payloadHash: `hash:${id}`,
      roundId: 'round-concurrency',
      gameId: 'game-concurrency',
      kind: WagerTransactionKind.Bet,
      amount,
      currency: 'BRL',
      correlationId: crypto.randomUUID(),
    };
  }

  it('should debit only once for 50 identical concurrent BET requests', async () => {
    const wallet = await createWallet();
    const useCase = new ProcessWagerTransactionUseCase(orm.em);
    const bet = createBet(wallet.walletId, wallet.playerId);

    const results = await Promise.allSettled(
      Array.from(
        { length: 50 },
        () => useCase.execute({ ...bet }),
      ),
    );

    const processed = results.filter(
      (result) =>
        result.status === 'fulfilled' &&
        result.value.status === WagerTransactionStatus.Processed,
    );

    expect(processed.length).toBe(50);

    const storedWallet = await new WalletRepository(
      orm.em.fork(),
    ).findById(wallet.walletId);

    const entries = await new WalletLedgerEntryRepository(
      orm.em.fork(),
    ).findByWalletId(wallet.walletId);

    expect(storedWallet?.balance.toString()).toBe('80.00');
    expect(entries.length).toBe(2);
  });

  it('should allow only one competing BET of 80 against a balance of 100', async () => {
    const wallet = await createWallet();
    const useCase = new ProcessWagerTransactionUseCase(orm.em);

    const firstBet = createBet(
      wallet.walletId,
      wallet.playerId,
      '80.00',
    );

    const secondBet = createBet(
      wallet.walletId,
      wallet.playerId,
      '80.00',
    );

    const results = await Promise.allSettled([
      useCase.execute(firstBet),
      useCase.execute(secondBet),
    ]);

    const processed = results.filter(
      (result) =>
        result.status === 'fulfilled' &&
        result.value.status === WagerTransactionStatus.Processed,
    );

    const rejected = results.filter(
      (result) =>
        result.status === 'fulfilled' &&
        result.value.status === WagerTransactionStatus.Rejected,
    );

    expect(processed.length).toBe(1);
    expect(rejected.length).toBe(1);

    const storedWallet = await new WalletRepository(
      orm.em.fork(),
    ).findById(wallet.walletId);

    const entries = await new WalletLedgerEntryRepository(
      orm.em.fork(),
    ).findByWalletId(wallet.walletId);

    expect(storedWallet?.balance.toString()).toBe('20.00');
    expect(entries.length).toBe(2);
  });

  it('should process concurrent BETs on independent wallets', async () => {
    const wallets = await Promise.all([
      createWallet(),
      createWallet(),
      createWallet(),
    ]);

    const useCase = new ProcessWagerTransactionUseCase(orm.em);

    const results = await Promise.all(
      wallets.map((wallet) =>
        useCase.execute(
          createBet(
            wallet.walletId,
            wallet.playerId,
            '30.00',
          ),
        ),
      ),
    );

    expect(results.length).toBe(3);

    for (const result of results) {
      expect(result.status).toBe(WagerTransactionStatus.Processed);
      expect(result.balance).toBe('70.00');
    }

    for (const wallet of wallets) {
      const storedWallet = await new WalletRepository(
        orm.em.fork(),
      ).findById(wallet.walletId);

      const entries = await new WalletLedgerEntryRepository(
        orm.em.fork(),
      ).findByWalletId(wallet.walletId);

      expect(storedWallet?.balance.toString()).toBe('70.00');
      expect(entries.length).toBe(2);
    }
  });
});
