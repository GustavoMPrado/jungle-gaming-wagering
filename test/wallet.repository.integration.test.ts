
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import ormConfig from '../src/mikro-orm.config.js';
import { Wallet } from '../src/domain/entities/wallet.js';
import { Money } from '../src/domain/value-objects/money.js';
import {
  WalletRepository,
} from '../src/infrastructure/persistence/wallet.repository.js';
import {
  WalletRecord,
} from '../src/infrastructure/persistence/wallet-record.entity.js';

describe('WalletRepository integration', () => {
  let orm: MikroORM;

  const walletId = '10000000-0000-4000-8000-000000000001';
  const duplicateWalletId =
    '10000000-0000-4000-8000-000000000002';

  const playerId = 'wallet-repository-test-player';

  beforeAll(async () => {
    orm = await MikroORM.init(ormConfig);
  });

  afterAll(async () => {
    if (!orm) {
      return;
    }

    await orm.em.fork().nativeDelete(WalletRecord, {
      playerId,
    });

    await orm.close();
  });

  function createWallet(
    id: string = walletId,
  ): Wallet {
    return Wallet.open({
      id,
      playerId,
      initialBalance: Money.create('0', 'BRL'),
    });
  }

  it('should persist and retrieve a zero-balance wallet', async () => {
    const em = orm.em.fork();
    const repository = new WalletRepository(em);

    await em.transactional(async (tx) => {
      const transactionalRepository =
        new WalletRepository(tx);

      await transactionalRepository.save(createWallet());
    });

    const stored = await repository.findById(walletId);

    expect(stored).not.toBeNull();
    expect(stored?.id).toBe(walletId);
    expect(stored?.playerId).toBe(playerId);
    expect(stored?.currency).toBe('BRL');
    expect(stored?.balance.toString()).toBe('0.00');
    expect(stored?.version).toBe(1);
  });

  it('should find a wallet by player and currency', async () => {
    const repository = new WalletRepository(orm.em.fork());

    const wallet = await repository.findByPlayerAndCurrency(
      playerId,
      'BRL',
    );

    expect(wallet?.id).toBe(walletId);
  });

  it('should reject duplicate player and currency', async () => {
    const em = orm.em.fork();

    await expect(
      em.transactional(async (tx) => {
        const repository = new WalletRepository(tx);

        await repository.save(
          createWallet(duplicateWalletId),
        );
      }),
    ).rejects.toThrow();

    const existing = await new WalletRepository(
      orm.em.fork(),
    ).findById(walletId);

    expect(existing?.id).toBe(walletId);
  });

  it('should load a wallet with a pessimistic lock', async () => {
    const em = orm.em.fork();

    await em.transactional(async (tx) => {
      const repository = new WalletRepository(tx);

      const wallet = await repository.findByIdForUpdate(
        walletId,
      );

      expect(wallet).not.toBeNull();
      expect(wallet?.balance.toString()).toBe('0.00');
    });
  });

  it('should return null for a missing wallet', async () => {
    const repository = new WalletRepository(orm.em.fork());

    const wallet = await repository.findById(
      '10000000-0000-4000-8000-000000000099',
    );

    expect(wallet).toBeNull();
  });
});
