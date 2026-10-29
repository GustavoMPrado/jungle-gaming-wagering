
import { describe, expect, it } from 'bun:test';
import {
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
  WagerTransactionPendingReference,
} from './wager-events.js';

describe('Wager events', () => {
  const baseProps = {
    eventId: 'event-1',
    aggregateId: 'transaction-1',
    correlationId: 'correlation-1',
    occurredAt: new Date('2026-10-29T15:00:00.000Z'),
  };

  it('should create a processed transaction event', () => {
    const event = new WagerTransactionProcessed({
      ...baseProps,
      data: {
        transactionId: 'transaction-1',
        walletId: 'wallet-1',
        kind: 'BET',
        money: {
          amount: '25.00',
          currency: 'BRL',
        },
      },
    });

    expect(event.eventType).toBe('WagerTransactionProcessed');
    expect(event.version).toBe(1);
    expect(event.data.money.amount).toBe('25.00');
    expect(event.data.money.currency).toBe('BRL');
  });

  it('should support processed LOSS transactions', () => {
    const event = new WagerTransactionProcessed({
      ...baseProps,
      data: {
        transactionId: 'transaction-1',
        walletId: 'wallet-1',
        kind: 'LOSS',
        money: {
          amount: '25.00',
          currency: 'BRL',
        },
      },
    });

    expect(event.data.kind).toBe('LOSS');
    expect(event.eventType).toBe('WagerTransactionProcessed');
  });

  it('should create a rejected transaction event', () => {
    const event = new WagerTransactionRejected({
      ...baseProps,
      data: {
        transactionId: 'transaction-1',
        walletId: 'wallet-1',
        failureCode: 'INSUFFICIENT_BALANCE',
      },
    });

    expect(event.eventType).toBe('WagerTransactionRejected');
    expect(event.version).toBe(1);
    expect(event.data.failureCode).toBe('INSUFFICIENT_BALANCE');
  });

  it('should create a wallet balance changed event', () => {
    const event = new WalletBalanceChanged({
      ...baseProps,
      aggregateId: 'wallet-1',
      data: {
        transactionId: 'transaction-1',
        walletId: 'wallet-1',
        balanceBefore: {
          amount: '100.00',
          currency: 'BRL',
        },
        balanceAfter: {
          amount: '75.00',
          currency: 'BRL',
        },
      },
    });

    expect(event.eventType).toBe('WalletBalanceChanged');
    expect(event.aggregateId).toBe('wallet-1');
    expect(event.data.balanceBefore.amount).toBe('100.00');
    expect(event.data.balanceAfter.amount).toBe('75.00');
  });

  it('should create a pending reference event', () => {
    const event = new WagerTransactionPendingReference({
      ...baseProps,
      data: {
        transactionId: 'transaction-1',
        walletId: 'wallet-1',
        referenceExternalTransactionId: 'external-bet-1',
        nextReferenceAttemptAt: '2026-10-29T15:00:01.000Z',
      },
    });

    expect(event.eventType).toBe(
      'WagerTransactionPendingReference',
    );
    expect(event.version).toBe(1);
    expect(event.data.referenceExternalTransactionId).toBe(
      'external-bet-1',
    );
  });

  it('should serialize financial values as strings', () => {
    const event = new WalletBalanceChanged({
      ...baseProps,
      data: {
        transactionId: 'transaction-1',
        walletId: 'wallet-1',
        balanceBefore: {
          amount: '100.00',
          currency: 'BRL',
        },
        balanceAfter: {
          amount: '125.00',
          currency: 'BRL',
        },
      },
    });

    const serialized = JSON.stringify(event);
    const parsed = JSON.parse(serialized) as {
      data: {
        balanceBefore: { amount: string };
        balanceAfter: { amount: string };
      };
    };

    expect(parsed.data.balanceBefore.amount).toBe('100.00');
    expect(parsed.data.balanceAfter.amount).toBe('125.00');
    expect(typeof parsed.data.balanceAfter.amount).toBe('string');
  });

  it('should preserve the event identifier in its envelope', () => {
    const event = new WagerTransactionRejected({
      ...baseProps,
      data: {
        transactionId: 'transaction-1',
        walletId: 'wallet-1',
        failureCode: 'INVALID_REFERENCE_STATUS',
      },
    });

    expect(event.toJSON().eventId).toBe(event.eventId);
    expect(event.toJSON().correlationId).toBe('correlation-1');
  });
});
