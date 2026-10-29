
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

  function createRefund(): WagerTransaction {
    return WagerTransaction.create({
      ...createProps(WagerTransactionKind.Refund),
      referenceExternalTransactionId: 'external-bet-1',
    });
  }

  function createRollback(): WagerTransaction {
    return WagerTransaction.create({
      ...createProps(WagerTransactionKind.Rollback),
      referenceExternalTransactionId: 'external-bet-1',
    });
  }

  describe('create', () => {
    it('should create a pending transaction', () => {
      const transaction = WagerTransaction.create(createProps());

      expect(transaction.status).toBe(WagerTransactionStatus.Pending);
      expect(transaction.kind).toBe(WagerTransactionKind.Bet);
      expect(transaction.money.toString()).toBe('25.00');
      expect(transaction.isTerminal()).toBe(false);
      expect(transaction.referenceAttempts).toBe(0);
      expect(transaction.nextReferenceAttemptAt).toBeUndefined();
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
      const transaction = createRefund();

      expect(transaction.referenceExternalTransactionId).toBe(
        'external-bet-1',
      );
      expect(transaction.status).toBe(WagerTransactionStatus.Pending);
    });

    it('should identify transactions requiring a reference', () => {
      expect(createRefund().requiresReference()).toBe(true);
      expect(createRollback().requiresReference()).toBe(true);

      expect(
        WagerTransaction.create(createProps()).requiresReference(),
      ).toBe(false);

      expect(
        WagerTransaction.create(
          createProps(WagerTransactionKind.Win),
        ).requiresReference(),
      ).toBe(false);
    });
  });

  describe('createOpening', () => {
    it('should create an internal processed OPENING transaction', () => {
      const transaction = WagerTransaction.createOpening({
        id: 'opening-1',
        walletId: 'wallet-1',
        playerId: 'player-1',
        money: Money.create('100.00', 'BRL'),
      });

      expect(transaction.kind).toBe(WagerTransactionKind.Opening);
      expect(transaction.status).toBe(WagerTransactionStatus.Processed);
      expect(transaction.providerId).toBe('INTERNAL');
      expect(transaction.idempotencyKey).toBe('opening:wallet-1');
      expect(transaction.money.toString()).toBe('100.00');
      expect(transaction.isTerminal()).toBe(true);
      expect(transaction.processedAt).toBeDefined();
      expect(transaction.referenceAttempts).toBe(0);
    });

    it('should preserve the opening timestamp', () => {
      const createdAt = new Date('2026-10-29T15:00:00.000Z');

      const transaction = WagerTransaction.createOpening({
        id: 'opening-1',
        walletId: 'wallet-1',
        playerId: 'player-1',
        money: Money.create('100.00', 'BRL'),
        createdAt,
      });

      expect(transaction.createdAt).toEqual(createdAt);
      expect(transaction.processedAt).toEqual(createdAt);
    });

    it('should reject zero and negative opening amounts', () => {
      const amounts = [
        Money.create('0', 'BRL'),
        Money.create('10.00', 'BRL').negate(),
      ];

      for (const amount of amounts) {
        expect(() =>
          WagerTransaction.createOpening({
            id: 'opening-1',
            walletId: 'wallet-1',
            playerId: 'player-1',
            money: amount,
          }),
        ).toThrow('Opening amount must be positive');
      }
    });

    it('should reject missing identification', () => {
      const validProps = {
        id: 'opening-1',
        walletId: 'wallet-1',
        playerId: 'player-1',
        money: Money.create('100.00', 'BRL'),
      };

      for (const field of ['id', 'walletId', 'playerId'] as const) {
        expect(() =>
          WagerTransaction.createOpening({
            ...validProps,
            [field]: '',
          }),
        ).toThrow('Invalid transaction identification');
      }
    });

    it('should prevent changes to a processed opening', () => {
      const transaction = WagerTransaction.createOpening({
        id: 'opening-1',
        walletId: 'wallet-1',
        playerId: 'player-1',
        money: Money.create('100.00', 'BRL'),
      });

      expect(() => transaction.markProcessed()).toThrow(
        'Transaction is already terminal',
      );
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
      expect(() => transaction.markPendingReference()).toThrow(
        'Transaction is not pending',
      );
    });

    it('should reject an empty failure code', () => {
      const transaction = WagerTransaction.create(createProps());

      expect(() => transaction.markRejected('')).toThrow(
        'Failure code is required',
      );
      expect(transaction.status).toBe(WagerTransactionStatus.Pending);
    });

    it('should protect creation and processing timestamps', () => {
      const createdAt = new Date('2026-10-29T15:00:00.000Z');
      const processedAt = new Date('2026-10-29T15:05:00.000Z');

      const transaction = WagerTransaction.create({
        ...createProps(),
        createdAt,
      });

      transaction.markProcessed(processedAt);

      createdAt.setFullYear(2030);
      processedAt.setFullYear(2030);

      expect(transaction.createdAt.getFullYear()).toBe(2026);
      expect(transaction.processedAt?.getFullYear()).toBe(2026);

      transaction.createdAt.setFullYear(2040);
      transaction.processedAt?.setFullYear(2040);

      expect(transaction.createdAt.getFullYear()).toBe(2026);
      expect(transaction.processedAt?.getFullYear()).toBe(2026);
    });
  });

  describe('references', () => {
    it('should mark a refund as pending reference', () => {
      const transaction = createRefund();
      const now = new Date('2026-10-29T15:00:00.000Z');

      transaction.markPendingReference(now);

      expect(transaction.status).toBe(
        WagerTransactionStatus.PendingReference,
      );
      expect(transaction.referenceAttempts).toBe(0);
      expect(transaction.nextReferenceAttemptAt?.toISOString()).toBe(
        '2026-10-29T15:00:01.000Z',
      );
    });

    it('should allow a rollback to wait for its reference', () => {
      const transaction = createRollback();

      transaction.markPendingReference(
        new Date('2026-10-29T15:00:00.000Z'),
      );

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
      transaction.markProcessed(
        new Date(),
        'original-transaction-1',
      );

      expect(transaction.status).toBe(WagerTransactionStatus.Processed);
      expect(transaction.referenceTransactionId).toBe(
        'original-transaction-1',
      );
      expect(transaction.nextReferenceAttemptAt).toBeUndefined();
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

    it('should schedule all ten reference retries', () => {
      const transaction = createRefund();
      const delays = [1, 2, 4, 8, 16, 32, 60, 60, 60, 60];

      let now = new Date('2026-10-29T15:00:00.000Z');

      transaction.markPendingReference(now);

      for (let attempt = 0; attempt < delays.length; attempt++) {
        const expectedDue = new Date(
          now.getTime() + delays[attempt] * 1000,
        );

        expect(transaction.nextReferenceAttemptAt).toEqual(
          expectedDue,
        );

        now = expectedDue;

        expect(transaction.isReferenceRetryDue(now)).toBe(true);

        transaction.recordReferenceAttempt(now);

        expect(transaction.referenceAttempts).toBe(attempt + 1);
      }

      expect(transaction.referenceAttempts).toBe(10);
      expect(transaction.hasReferenceAttemptsRemaining()).toBe(false);
      expect(transaction.nextReferenceAttemptAt).toBeUndefined();
    });

    it('should not allow retries before the scheduled time', () => {
      const transaction = createRefund();
      const now = new Date('2026-10-29T15:00:00.000Z');

      transaction.markPendingReference(now);

      expect(transaction.isReferenceRetryDue(now)).toBe(false);

      expect(() => transaction.recordReferenceAttempt(now)).toThrow(
        'Reference retry is not due',
      );

      expect(transaction.referenceAttempts).toBe(0);
    });

    it('should not allow more than ten reference attempts', () => {
      const transaction = createRefund();
      let now = new Date('2026-10-29T15:00:00.000Z');

      transaction.markPendingReference(now);

      for (let attempt = 0; attempt < 10; attempt++) {
        now = transaction.nextReferenceAttemptAt!;
        transaction.recordReferenceAttempt(now);
      }

      expect(() => transaction.recordReferenceAttempt(now)).toThrow(
        'Reference retry limit reached',
      );
    });

    it('should clear the schedule when a reference is rejected', () => {
      const transaction = createRefund();

      transaction.markPendingReference(
        new Date('2026-10-29T15:00:00.000Z'),
      );

      transaction.markRejected('REFERENCE_NOT_FOUND');

      expect(transaction.status).toBe(WagerTransactionStatus.Rejected);
      expect(transaction.nextReferenceAttemptAt).toBeUndefined();
      expect(transaction.isReferenceRetryDue()).toBe(false);
    });

    it('should clear the schedule on permanent failure', () => {
      const transaction = createRefund();

      transaction.markPendingReference(
        new Date('2026-10-29T15:00:00.000Z'),
      );

      transaction.markFailed('PERMANENT_FAILURE');

      expect(transaction.status).toBe(WagerTransactionStatus.Failed);
      expect(transaction.nextReferenceAttemptAt).toBeUndefined();
    });

    it('should prevent retries on terminal transactions', () => {
      const transaction = createRefund();

      transaction.markPendingReference();
      transaction.markRejected('INVALID_REFERENCE_STATUS');

      expect(() => transaction.recordReferenceAttempt()).toThrow(
        'Transaction is not pending reference',
      );
    });

    it('should protect the next attempt timestamp', () => {
      const transaction = createRefund();
      const now = new Date('2026-10-29T15:00:00.000Z');

      transaction.markPendingReference(now);

      now.setFullYear(2030);

      expect(
        transaction.nextReferenceAttemptAt?.getFullYear(),
      ).toBe(2026);

      transaction.nextReferenceAttemptAt?.setFullYear(2040);

      expect(
        transaction.nextReferenceAttemptAt?.getFullYear(),
      ).toBe(2026);
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

    it('should restore persisted reference retry information', () => {
      const nextAttempt = new Date('2026-10-29T15:00:08.000Z');

      const transaction = WagerTransaction.rehydrate({
        ...createProps(WagerTransactionKind.Refund),
        referenceExternalTransactionId: 'external-bet-1',
        status: WagerTransactionStatus.PendingReference,
        referenceAttempts: 3,
        nextReferenceAttemptAt: nextAttempt,
      });

      expect(transaction.status).toBe(
        WagerTransactionStatus.PendingReference,
      );
      expect(transaction.referenceAttempts).toBe(3);
      expect(transaction.nextReferenceAttemptAt).toEqual(nextAttempt);
    });

    it('should reject invalid persisted attempt counts', () => {
      for (const attempts of [-1, 11, 1.5]) {
        expect(() =>
          WagerTransaction.rehydrate({
            ...createProps(WagerTransactionKind.Refund),
            referenceExternalTransactionId: 'external-bet-1',
            status: WagerTransactionStatus.PendingReference,
            referenceAttempts: attempts,
          }),
        ).toThrow('Invalid reference attempts');
      }
    });

    it('should restore an exhausted reference state', () => {
      const transaction = WagerTransaction.rehydrate({
        ...createProps(WagerTransactionKind.Refund),
        referenceExternalTransactionId: 'external-bet-1',
        status: WagerTransactionStatus.PendingReference,
        referenceAttempts: 10,
      });

      expect(transaction.referenceAttempts).toBe(10);
      expect(transaction.hasReferenceAttemptsRemaining()).toBe(false);
      expect(transaction.nextReferenceAttemptAt).toBeUndefined();
    });
  });
});


