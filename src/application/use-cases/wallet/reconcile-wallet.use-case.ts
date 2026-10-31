import type { EntityManager } from '@mikro-orm/postgresql';

import { Money } from '../../../domain/value-objects/money.js';
import {
  LedgerDirection,
} from '../../../domain/entities/wallet-ledger-entry.js';
import {
  WalletRepository,
} from '../../../infrastructure/persistence/repository/wallet.repository.js';
import {
  WalletLedgerEntryRepository,
} from '../../../infrastructure/persistence/repository/wallet-ledger-entry.repository.js';

export interface ReconciliationResult {
  walletId: string;
  storedBalance: {
    amount: string;
    currency: string;
  };
  calculatedBalance: {
    amount: string;
    currency: string;
  };
  difference: {
    amount: string;
    currency: string;
  };
  consistent: boolean;
  checkedEntries: number;
}

export class ReconcileWalletUseCase {
  public constructor(
    private readonly em: EntityManager,
  ) {}

  public async execute(
    walletId: string,
  ): Promise<ReconciliationResult | null> {
    return this.em.fork().transactional(async (em) => {
      await em.execute(
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',
      );

      const walletRepository = new WalletRepository(em);
      const ledgerRepository = new WalletLedgerEntryRepository(em);

      const wallet = await walletRepository.findById(walletId);

      if (!wallet) {
        return null;
      }

      const entries = await ledgerRepository.findByWalletId(
        walletId,
      );

      let calculatedBalance = Money.create('0.00', wallet.currency);

      for (const entry of entries) {
        if (entry.direction === LedgerDirection.Credit) {
          calculatedBalance = calculatedBalance.add(entry.money);
        } else {
          calculatedBalance = calculatedBalance.subtract(
            entry.money,
          );
        }
      }

      const storedBalance = wallet.balance;

      const difference = storedBalance.subtract(
        calculatedBalance,
      );

      return {
        walletId: wallet.id,
        storedBalance: storedBalance.toJSON(),
        calculatedBalance: calculatedBalance.toJSON(),
        difference: difference.toJSON(),
        consistent: storedBalance.equals(calculatedBalance),
        checkedEntries: entries.length,
      };
    });
  }
}
