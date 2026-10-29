
import { describe, expect, it } from 'bun:test';
import { Money } from '../value-objects/money.js';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
  type CreateWagerTransactionProps,
} from './wager-transaction.js';

describe('WagerTransaction', () => {
  function createProps(
    kind: WagerTransactionKind = WagerTransactionKind.Bet,
  ): CreateWagerTransactionProps {
    return {
      id: 'transaction-1',
      providerId: 'provider-1',
      externalTransactionId: 'external-1',
      idempotencyKey: 'provider-1:external-1',
      payloadHash: 'hash-123',
      walletId: 'wallet-1',
      playerId: 'player-1',
      roundId: 'round-1',
      gameId: 'game-1',
      kind,
      money: Money.create('25.00', 'BRL'),
    };
  }

  describe('create', () => {
    it('should create a pending transaction', () => {
      const transaction = WagerTransaction.create(createProps());

      expect(transaction.status).toBe(WagerTransactionStatus.Pending);
      expect(transaction.kind).toBe(WagerTransactionKind.Bet);
      expect(transaction.money.toString()).toBe('25.00');
      expect(transaction.isTerminal()).toBe(false);
    });

    it('should reject external OPENING transactions', () => {
      expect(() =>
        WagerTransaction.create(
          createProps(WagerTransactionKind.Opening),
        ),
      ).toThrow('OPENING is an internal transaction');
    });

    it('should reject missing identification', () => {
      expect(() =>
        WagerTransaction.create({
          ...createProps(),
          providerId: '',
        }),
      ).toThrow('Invalid transaction identification');
    });

    it('should reject zero and negative amounts', () => {
      expect(() =>
        WagerTransaction.create({
          ...createProps(),
          money: Money.create('0', 'BRL'),
        }),
      ).toThrow('Transaction amount must be positive');

      expect(() =>
        WagerTransaction.create({
          ...createProps(),
          money: Money.create('10.00', 'BRL').negate(),
        }),
      ).toThrow('Transaction amount must be positive');
    });

    it.each([
      WagerTransactionKind.Refund,
      WagerTransactionKind.Rollback,
    ])('should require a reference for %s', (kind) => {
      expect(() =>
        WagerTransaction.create(createProps(kind)),
      ).toThrow('Transaction reference is required');
    });

    it('should accept a refund with an external reference', () => {
      const transaction = WagerTransaction.create({
        ...createProps(WagerTransactionKind.Refund),
        referenceExternalTransactionId: 'external-bet-1',
      });

      expect(transaction.referenceExternalTransactionId).toBe(
        'external-bet-1',
      );
      expect(transaction.status).toBe(WagerTransactionStatus.Pending);
    });
  });

  describe('state transitions', () => {
    it('should process a pending transaction', () => {
      const transaction = WagerTransaction.create(createProps());
      const date = new Date('2026-10-29T15:00:00.000Z');

      transaction.markProcessed(date);

      expect(transaction.status).toBe(WagerTransactionStatus.Processed);
      expect(transaction.processedAt).toEqual(date);
      expect(transaction.isTerminal()).toBe(true);
    });

    it('should reject a transaction with a failure code', () => {
      const transaction = WagerTransaction.create(createProps());

      transaction.markRejected('INSUFFICIENT_BALANCE');

      expect(transaction.status).toBe(WagerTransactionStatus.Rejected);
      expect(transaction.failureCode).toBe('INSUFFICIENT_BALANCE');
      expect(transaction.isTerminal()).toBe(true);
    });

    it('should mark a transaction as failed', () => {
      const transaction = WagerTransaction.create(createProps());

      transaction.markFailed('PERMANENT_FAILURE');

      expect(transaction.status).toBe(WagerTransactionStatus.Failed);
      expect(transaction.failureCode).toBe('PERMANENT_FAILURE');
      expect(transaction.isTerminal()).toBe(true);
    });

    it('should prevent changes to terminal transactions', () => {
      const transaction = WagerTransaction.create(createProps());

      transaction.markProcessed();

      expect(() => transaction.markProcessed()).toThrow(
        'Transaction is already terminal',
      );
      expect(() => transaction.markRejected('ERROR')).toThrow(
        'Transaction is already terminal',
      );
      expect(() => transaction.markFailed('ERROR')).toThrow(
        'Transaction is already terminal',
      );
    });

    it('should reject an empty failure code', () => {
      const transaction = WagerTransaction.create(createProps());

      expect(() => transaction.markRejected('')).toThrow(
        'Failure code is required',
      );
      expect(transaction.status).toBe(WagerTransactionStatus.Pending);
    });
  });

  describe('references', () => {
    function createRefund(): WagerTransaction {
      return WagerTransaction.create({
        ...createProps(WagerTransactionKind.Refund),
        referenceExternalTransactionId: 'external-bet-1',
      });
    }

    it('should mark a refund as pending reference', () => {
      const transaction = createRefund();

      transaction.markPendingReference();

      expect(transaction.status).toBe(
        WagerTransactionStatus.PendingReference,
      );
    });

    it('should prevent ordinary bets from waiting for references', () => {
      const transaction = WagerTransaction.create(createProps());

      expect(() => transaction.markPendingReference()).toThrow(
        'Transaction does not require a reference',
      );
    });

    it('should process a refund after resolving its reference', () => {
      const transaction = createRefund();

      transaction.markPendingReference();
      transaction.markProcessed(new Date(), 'original-transaction-1');

      expect(transaction.status).toBe(WagerTransactionStatus.Processed);
      expect(transaction.referenceTransactionId).toBe(
        'original-transaction-1',
      );
    });

    it('should reject processing a refund without resolved reference', () => {
      const transaction = createRefund();

      expect(() => transaction.markProcessed()).toThrow(
        'Resolved reference is required',
      );
      expect(transaction.status).toBe(WagerTransactionStatus.Pending);
    });

    it('should prevent repeated pending reference transitions', () => {
      const transaction = createRefund();

      transaction.markPendingReference();

      expect(() => transaction.markPendingReference()).toThrow(
        'Transaction is not pending',
      );
    });
  });

  describe('rehydrate', () => {
    it('should restore persisted state without replaying transitions', () => {
      const transaction = WagerTransaction.rehydrate({
        ...createProps(),
        status: WagerTransactionStatus.Processed,
        processedAt: new Date('2026-10-29T15:00:00.000Z'),
      });

      expect(transaction.status).toBe(WagerTransactionStatus.Processed);
      expect(transaction.isTerminal()).toBe(true);
    });
  });
});
