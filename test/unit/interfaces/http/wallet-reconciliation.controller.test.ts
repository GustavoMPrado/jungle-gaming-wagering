import { describe, expect, it, mock } from 'bun:test';
import { NotFoundException } from '@nestjs/common';

import { WalletController } from '../../../../src/interfaces/http/wallet.controller.js';
import type { CreateWalletUseCase } from '../../../../src/application/use-cases/wallet/create-wallet.use-case.js';
import type { GetWalletUseCase } from '../../../../src/application/use-cases/wallet/get-wallet.use-case.js';
import type { GetWalletLedgerUseCase } from '../../../../src/application/use-cases/wallet/get-wallet-ledger.use-case.js';
import type { ReconcileWalletUseCase } from '../../../../src/application/use-cases/wallet/reconcile-wallet.use-case.js';

const walletId = 'b4321ef4-1cd0-4c81-887f-47a2ac391ea1';

function createController(
  execute: ReconcileWalletUseCase['execute'],
): WalletController {
  return new WalletController(
    {} as CreateWalletUseCase,
    {} as GetWalletUseCase,
    {} as GetWalletLedgerUseCase,
    { execute } as ReconcileWalletUseCase,
  );
}

describe('Wallet reconciliation endpoint', () => {
  it('returns a consistent wallet reconciliation', async () => {
    const controller = createController(async () => ({
      walletId,
      storedBalance: { amount: '100.00', currency: 'BRL' },
      calculatedBalance: { amount: '100.00', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 1,
    }));

    const result = await controller.reconcile(walletId);

    expect(result.consistent).toBe(true);
    expect(result.difference.amount).toBe('0.00');
    expect(result.checkedEntries).toBe(1);
  });

  it('returns 404 when the wallet does not exist', async () => {
    const controller = createController(async () => null);

    expect(controller.reconcile(walletId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reports a financial mismatch without correcting it', async () => {
    const log = mock((_message: string) => {});
    const originalError = console.error;
    console.error = log;

    try {
      const controller = createController(async () => ({
        walletId,
        storedBalance: { amount: '90.00', currency: 'BRL' },
        calculatedBalance: { amount: '100.00', currency: 'BRL' },
        difference: { amount: '-10.00', currency: 'BRL' },
        consistent: false,
        checkedEntries: 1,
      }));

      const result = await controller.reconcile(walletId);

      expect(result.consistent).toBe(false);
      expect(result.difference.amount).toBe('-10.00');
      expect(log).toHaveBeenCalledTimes(1);

      const loggedEvent = JSON.parse(
        String(log.mock.calls[0]?.[0]),
      ) as { event: string; walletId: string };

      expect(loggedEvent.event).toBe(
        'wallet_reconciliation_mismatch',
      );
      expect(loggedEvent.walletId).toBe(walletId);
    } finally {
      console.error = originalError;
    }
  });
});
