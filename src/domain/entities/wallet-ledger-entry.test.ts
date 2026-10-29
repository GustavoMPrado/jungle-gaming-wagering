
import { describe, expect, it } from 'bun:test';
import {
  LedgerDirection,
  WalletLedgerEntry,
  type CreateWalletLedgerEntryProps,
} from './wallet-ledger-entry.js';
import { Money } from '../value-objects/money.js';

describe('WalletLedgerEntry', () => {
  function createProps(
    direction: LedgerDirection = LedgerDirection.Debit,
  ): CreateWalletLedgerEntryProps {
    return {
      id: 'ledger-1',
      walletId: 'wallet-1',
      transactionId: 'transaction-1',
      direction,
      money: Money.create('25.00', 'BRL'),
      balanceBefore: Money.create('100.00', 'BRL'),
      balanceAfter: Money.create(
        direction === LedgerDirection.Debit ? '75.00' : '125.00',
        'BRL',
      ),
    };
  }

  describe('create', () => {
    it('should create a valid debit entry', () => {
      const entry = WalletLedgerEntry.create(createProps());

      expect(entry.direction).toBe(LedgerDirection.Debit);
      expect(entry.money.toString()).toBe('25.00');
      expect(entry.balanceBefore.toString()).toBe('100.00');
      expect(entry.balanceAfter.toString()).toBe('75.00');
      expect(entry.isBalanced()).toBe(true);
    });

    it('should create a valid credit entry', () => {
      const entry = WalletLedgerEntry.create(
        createProps(LedgerDirection.Credit),
      );

      expect(entry.balanceAfter.toString()).toBe('125.00');
      expect(entry.isBalanced()).toBe(true);
    });

    it('should reject invalid identification', () => {
      expect(() =>
        WalletLedgerEntry.create({
          ...createProps(),
          walletId: '',
        }),
      ).toThrow('Invalid ledger identification');
    });

    it('should reject invalid direction', () => {
      expect(() =>
        WalletLedgerEntry.create({
          ...createProps(),
          direction: 'INVALID' as LedgerDirection,
        }),
      ).toThrow('Invalid ledger direction');
    });

    it('should reject zero and negative amounts', () => {
      expect(() =>
        WalletLedgerEntry.create({
          ...createProps(),
          money: Money.create('0', 'BRL'),
        }),
      ).toThrow('Ledger amount must be positive');

      expect(() =>
        WalletLedgerEntry.create({
          ...createProps(),
          money: Money.create('10.00', 'BRL').negate(),
        }),
      ).toThrow('Ledger amount must be positive');
    });

    it('should reject currency mismatch', () => {
      expect(() =>
        WalletLedgerEntry.create({
          ...createProps(),
          money: Money.create('25.00', 'USD'),
        }),
      ).toThrow('Currency mismatch');
    });

    it('should reject negative balances', () => {
      expect(() =>
        WalletLedgerEntry.create({
          ...createProps(),
          balanceAfter: Money.create('10.00', 'BRL').negate(),
        }),
      ).toThrow('Ledger balance cannot be negative');
    });

    it('should reject inconsistent debit arithmetic', () => {
      expect(() =>
        WalletLedgerEntry.create({
          ...createProps(),
          balanceAfter: Money.create('80.00', 'BRL'),
        }),
      ).toThrow('Ledger balance mismatch');
    });

    it('should reject inconsistent credit arithmetic', () => {
      expect(() =>
        WalletLedgerEntry.create({
          ...createProps(LedgerDirection.Credit),
          balanceAfter: Money.create('120.00', 'BRL'),
        }),
      ).toThrow('Ledger balance mismatch');
    });

    it('should allow a debit that reduces the balance to zero', () => {
      const entry = WalletLedgerEntry.create({
        ...createProps(),
        money: Money.create('100.00', 'BRL'),
        balanceAfter: Money.create('0', 'BRL'),
      });

      expect(entry.isBalanced()).toBe(true);
      expect(entry.balanceAfter.isZero()).toBe(true);
    });
  });

  describe('rehydrate', () => {
    it('should reconstruct an existing ledger entry', () => {
      const entry = WalletLedgerEntry.rehydrate(createProps());

      expect(entry.id).toBe('ledger-1');
      expect(entry.transactionId).toBe('transaction-1');
      expect(entry.isBalanced()).toBe(true);
    });

    it('should detect inconsistent persisted arithmetic', () => {
      const entry = WalletLedgerEntry.rehydrate({
        ...createProps(),
        balanceAfter: Money.create('90.00', 'BRL'),
      });

      expect(entry.isBalanced()).toBe(false);
    });
  });

  describe('immutability', () => {
    it('should preserve the entry timestamp', () => {
      const createdAt = new Date('2026-10-29T15:00:00.000Z');

      const entry = WalletLedgerEntry.create({
        ...createProps(),
        createdAt,
      });

      expect(entry.createdAt).toEqual(createdAt);
    });

    it('should not expose methods to change a ledger entry', () => {
      const entry = WalletLedgerEntry.create(createProps());

      expect('update' in entry).toBe(false);
      expect('delete' in entry).toBe(false);
    });
  });
});
