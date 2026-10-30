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
import { GetWalletLedgerUseCase } from '../../../src/application/use-cases/wallet/get-wallet-ledger.use-case.js';
import {
  ProcessWagerTransactionUseCase,
  type ProcessWagerTransactionInput,
} from '../../../src/application/use-cases/wagering/process-wager-transaction.use-case.js';
import { WagerTransactionKind } from '../../../src/domain/entities/wager-transaction.js';

describe('GetWalletLedgerUseCase integration', () => {
  let orm: MikroORM;
  let walletId: string;
  let playerId: string;

  beforeAll(async () => {
    orm = await MikroORM.init(ormConfig);

    playerId = `ledger-player-${crypto.randomUUID()}`;

    const wallet = await new CreateWalletUseCase(orm.em).execute({
      playerId,
      currency: 'BRL',
      initialBalance: '100.00',
    });

    walletId = wallet.walletId;

    const processWager = new ProcessWagerTransactionUseCase(
      orm.em,
    );

    for (const [kind, amount] of [
      [WagerTransactionKind.Bet, '10.00'],
      [WagerTransactionKind.Win, '5.00'],
      [WagerTransactionKind.Bet, '15.00'],
    ] as const) {
      const transactionId = crypto.randomUUID();

      const input: ProcessWagerTransactionInput = {
        transactionId,
        walletId,
        playerId,
        providerId: 'ledger-test-provider',
        externalTransactionId: transactionId,
        idempotencyKey: `ledger:${transactionId}`,
        payloadHash: `hash:${transactionId}`,
        roundId: 'ledger-round',
        gameId: 'ledger-game',
        kind,
        amount,
        currency: 'BRL',
        correlationId: crypto.randomUUID(),
      };

      await processWager.execute(input);
    }
  });

  afterAll(async () => {
    if (orm) {
      await orm.close();
    }
  });

  it('should return the first page with a cursor', async () => {
    const useCase = new GetWalletLedgerUseCase(orm.em);

    const page = await useCase.execute({
      walletId,
      limit: 2,
    });

    expect(page).not.toBeNull();
    expect(page!.entries.length).toBe(2);
    expect(page!.hasMore).toBe(true);
    expect(typeof page!.nextCursor).toBe('string');
  });

  it('should return the next page without duplicate entries', async () => {
    const useCase = new GetWalletLedgerUseCase(orm.em);

    const firstPage = await useCase.execute({
      walletId,
      limit: 2,
    });

    const secondPage = await useCase.execute({
      walletId,
      limit: 2,
      cursor: firstPage!.nextCursor!,
    });

    expect(secondPage).not.toBeNull();
    expect(secondPage!.entries.length).toBe(2);
    expect(secondPage!.hasMore).toBe(false);
    expect(secondPage!.nextCursor).toBeNull();

    const allIds = [
      ...firstPage!.entries.map((entry) => entry.id),
      ...secondPage!.entries.map((entry) => entry.id),
    ];

    expect(new Set(allIds).size).toBe(4);
  });

  it('should return null for a missing wallet', async () => {
    const useCase = new GetWalletLedgerUseCase(orm.em);

    const result = await useCase.execute({
      walletId: crypto.randomUUID(),
    });

    expect(result).toBeNull();
  });

  it('should reject an invalid cursor', async () => {
    const useCase = new GetWalletLedgerUseCase(orm.em);

    await expect(
      useCase.execute({
        walletId,
        cursor: 'not-a-valid-cursor',
      }),
    ).rejects.toThrow('Invalid ledger cursor');
  });

  it('should reject an invalid limit', async () => {
    const useCase = new GetWalletLedgerUseCase(orm.em);

    await expect(
      useCase.execute({
        walletId,
        limit: 101,
      }),
    ).rejects.toThrow('Invalid ledger page limit');
  });
});
