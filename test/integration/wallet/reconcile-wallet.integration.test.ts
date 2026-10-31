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
import { ReconcileWalletUseCase } from '../../../src/application/use-cases/wallet/reconcile-wallet.use-case.js';

describe('ReconcileWalletUseCase integration', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init(ormConfig);
  });

  afterAll(async () => {
    if (orm) {
      await orm.close();
    }
  });

  it('should reconcile a wallet with zero balance', async () => {
    const createWallet = new CreateWalletUseCase(orm.em);
    const reconcileWallet = new ReconcileWalletUseCase(orm.em);

    const wallet = await createWallet.execute({
      playerId: `player-${crypto.randomUUID()}`,
      currency: 'BRL',
      initialBalance: '0.00',
    });

    const result = await reconcileWallet.execute(wallet.walletId);

    expect(result).not.toBeNull();
    expect(result?.storedBalance.amount).toBe('0.00');
    expect(result?.calculatedBalance.amount).toBe('0.00');
    expect(result?.difference.amount).toBe('0.00');
    expect(result?.consistent).toBe(true);
    expect(result?.checkedEntries).toBe(0);
  });

  it('should reconcile the opening balance using the ledger', async () => {
    const createWallet = new CreateWalletUseCase(orm.em);
    const reconcileWallet = new ReconcileWalletUseCase(orm.em);

    const wallet = await createWallet.execute({
      playerId: `player-${crypto.randomUUID()}`,
      currency: 'BRL',
      initialBalance: '100.00',
    });

    const result = await reconcileWallet.execute(wallet.walletId);

    expect(result).not.toBeNull();
    expect(result?.walletId).toBe(wallet.walletId);
    expect(result?.storedBalance.amount).toBe('100.00');
    expect(result?.calculatedBalance.amount).toBe('100.00');
    expect(result?.difference.amount).toBe('0.00');
    expect(result?.consistent).toBe(true);
    expect(result?.checkedEntries).toBe(1);
  });

  it('should return null when the wallet does not exist', async () => {
    const reconcileWallet = new ReconcileWalletUseCase(orm.em);

    const result = await reconcileWallet.execute(
      crypto.randomUUID(),
    );

    expect(result).toBeNull();
  });

  it('should not change the wallet balance during reconciliation', async () => {
    const createWallet = new CreateWalletUseCase(orm.em);
    const reconcileWallet = new ReconcileWalletUseCase(orm.em);

    const wallet = await createWallet.execute({
      playerId: `player-${crypto.randomUUID()}`,
      currency: 'BRL',
      initialBalance: '75.00',
    });

    const firstResult = await reconcileWallet.execute(wallet.walletId);
    const secondResult = await reconcileWallet.execute(wallet.walletId);

    expect(firstResult?.consistent).toBe(true);
    expect(secondResult?.consistent).toBe(true);
    expect(firstResult?.storedBalance.amount).toBe('75.00');
    expect(secondResult?.storedBalance.amount).toBe('75.00');
    expect(secondResult?.checkedEntries).toBe(1);
  });
});
