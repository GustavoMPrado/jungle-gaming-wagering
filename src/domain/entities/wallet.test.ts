
import { describe, expect, it } from 'bun:test';
import { Wallet } from './wallet.js';
import { Money } from '../value-objects/money.js';

describe('Wallet', () => {
  const initialBalance = Money.create('100.00', 'BRL');

  function createWallet(): Wallet {
    return Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance,
    });
  }

  describe('open', () => {
    it('should open a wallet with an initial balance', () => {
      const wallet = createWallet();

      expect(wallet.id).toBe('wallet-1');
      expect(wallet.playerId).toBe('player-1');
      expect(wallet.currency).toBe('BRL');
      expect(wallet.balance.toString()).toBe('100.00');
      expect(wallet.version).toBe(1);
    });

    it('should open a wallet with zero balance', () => {
      const wallet = Wallet.open({
        id: 'wallet-2',
        playerId: 'player-2',
        initialBalance: Money.create('0', 'BRL'),
      });

      expect(wallet.balance.isZero()).toBe(true);
      expect(wallet.version).toBe(1);
    });

    it('should reject negative initial balance', () => {
      expect(() =>
        Wallet.open({
          id: 'wallet-1',
          playerId: 'player-1',
          initialBalance: Money.create('10.00', 'BRL').negate(),
        }),
      ).toThrow('Wallet balance cannot be negative');
    });

    it('should reject invalid identification', () => {
      expect(() =>
        Wallet.open({
          id: '',
          playerId: 'player-1',
          initialBalance,
        }),
      ).toThrow('Invalid wallet identification');

      expect(() =>
        Wallet.open({
          id: 'wallet-1',
          playerId: ' ',
          initialBalance,
        }),
      ).toThrow('Invalid wallet identification');
    });
  });

  describe('debit', () => {
    it('should debit the wallet balance', () => {
      const wallet = createWallet();

      wallet.debit(Money.create('30.00', 'BRL'));

      expect(wallet.balance.toString()).toBe('70.00');
      expect(wallet.version).toBe(2);
    });

    it('should allow debiting the entire balance', () => {
      const wallet = createWallet();

      wallet.debit(Money.create('100.00', 'BRL'));

      expect(wallet.balance.toString()).toBe('0.00');
      expect(wallet.version).toBe(2);
    });

    it('should reject insufficient balance without changing state', () => {
      const wallet = createWallet();
      const previousUpdatedAt = wallet.updatedAt;

      expect(() =>
        wallet.debit(Money.create('150.00', 'BRL')),
      ).toThrow('Insufficient wallet balance');

      expect(wallet.balance.toString()).toBe('100.00');
      expect(wallet.version).toBe(1);
      expect(wallet.updatedAt).toEqual(previousUpdatedAt);
    });

    it('should reject zero and negative debit amounts', () => {
      const wallet = createWallet();

      expect(() =>
        wallet.debit(Money.create('0', 'BRL')),
      ).toThrow('Transaction amount must be positive');

      expect(() =>
        wallet.debit(Money.create('10.00', 'BRL').negate()),
      ).toThrow('Transaction amount must be positive');

      expect(wallet.version).toBe(1);
    });
  });

  describe('credit', () => {
    it('should credit the wallet balance', () => {
      const wallet = createWallet();

      wallet.credit(Money.create('25.50', 'BRL'));

      expect(wallet.balance.toString()).toBe('125.50');
      expect(wallet.version).toBe(2);
    });

    it('should reject zero and negative credit amounts', () => {
      const wallet = createWallet();

      expect(() =>
        wallet.credit(Money.create('0', 'BRL')),
      ).toThrow('Transaction amount must be positive');

      expect(() =>
        wallet.credit(Money.create('10.00', 'BRL').negate()),
      ).toThrow('Transaction amount must be positive');

      expect(wallet.balance.toString()).toBe('100.00');
      expect(wallet.version).toBe(1);
    });

    it('should reject credit overflow without changing state', () => {
      const wallet = Wallet.open({
        id: 'wallet-max',
        playerId: 'player-1',
        initialBalance: Money.create('999999999999999999.99', 'BRL'),
      });

      expect(() =>
        wallet.credit(Money.create('0.01', 'BRL')),
      ).toThrow('Monetary amount exceeds maximum precision');

      expect(wallet.version).toBe(1);
      expect(wallet.balance.toString()).toBe('999999999999999999.99');
    });
  });

  describe('currency', () => {
    it('should reject operations with different currencies', () => {
      const wallet = createWallet();
      const usd = Money.create('10.00', 'USD');

      expect(() => wallet.debit(usd)).toThrow('Currency mismatch');
      expect(() => wallet.credit(usd)).toThrow('Currency mismatch');

      expect(wallet.balance.toString()).toBe('100.00');
      expect(wallet.version).toBe(1);
    });
  });

  describe('version and timestamps', () => {
    it('should increment version for each balance change', () => {
      const wallet = createWallet();

      wallet.debit(Money.create('20.00', 'BRL'));
      wallet.credit(Money.create('10.00', 'BRL'));

      expect(wallet.balance.toString()).toBe('90.00');
      expect(wallet.version).toBe(3);
    });

    it('should update the timestamp after a successful operation', () => {
      const wallet = createWallet();
      const operationDate = new Date('2026-10-29T15:00:00.000Z');

      wallet.debit(Money.create('10.00', 'BRL'), operationDate);

      expect(wallet.updatedAt).toEqual(operationDate);
    });
  });

  describe('rehydrate', () => {
    it('should reconstruct persisted wallet state', () => {
      const createdAt = new Date('2026-10-01T10:00:00.000Z');
      const updatedAt = new Date('2026-10-20T10:00:00.000Z');

      const wallet = Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        balance: Money.rehydrate('250.00', 'BRL'),
        version: 5,
        createdAt,
        updatedAt,
      });

      expect(wallet.balance.toString()).toBe('250.00');
      expect(wallet.version).toBe(5);
      expect(wallet.createdAt).toEqual(createdAt);
      expect(wallet.updatedAt).toEqual(updatedAt);
    });
  });
});
