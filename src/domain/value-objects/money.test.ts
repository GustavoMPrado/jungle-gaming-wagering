
import { describe, expect, it } from 'bun:test';
import { Money } from './money.js';

describe('Money', () => {
  describe('create', () => {
    it('should create a valid monetary value', () => {
      const money = Money.create('100.50', 'BRL');

      expect(money.toString()).toBe('100.50');
      expect(money.currency).toBe('BRL');
    });

    it('should format values with two decimal places', () => {
      expect(Money.create('10', 'BRL').toString()).toBe('10.00');
      expect(Money.create('10.5', 'BRL').toString()).toBe('10.50');
      expect(Money.create('0', 'BRL').toString()).toBe('0.00');
    });

    it.each([
      '-10.00',
      '10.999',
      '1e3',
      'NaN',
      'Infinity',
      '',
      '10,50',
      'abc',
      ' 10.00',
    ])('should reject invalid amount %s', (amount) => {
      expect(() => Money.create(amount, 'BRL')).toThrow(
        'Invalid monetary amount',
      );
    });

    it.each(['', 'brl', 'BR', 'BRLL', '123'])(
      'should reject invalid currency %s',
      (currency) => {
        expect(() => Money.create('10.00', currency)).toThrow(
          'Invalid currency',
        );
      },
    );
  });

  describe('arithmetic', () => {
    it('should add monetary values precisely', () => {
      const a = Money.create('0.10', 'BRL');
      const b = Money.create('0.20', 'BRL');

      expect(a.add(b).toString()).toBe('0.30');
    });

    it('should subtract monetary values precisely', () => {
      const a = Money.create('100.00', 'BRL');
      const b = Money.create('25.75', 'BRL');

      expect(a.subtract(b).toString()).toBe('74.25');
    });

    it('should allow negative internal results', () => {
      const a = Money.create('10.00', 'BRL');
      const b = Money.create('20.00', 'BRL');

      const result = a.subtract(b);

      expect(result.toString()).toBe('-10.00');
      expect(result.isNegative()).toBe(true);
    });

    it('should negate a monetary value', () => {
      const money = Money.create('15.50', 'BRL');

      expect(money.negate().toString()).toBe('-15.50');
    });

    it('should reject arithmetic between different currencies', () => {
      const brl = Money.create('10.00', 'BRL');
      const usd = Money.create('10.00', 'USD');

      expect(() => brl.add(usd)).toThrow('Currency mismatch');
      expect(() => brl.subtract(usd)).toThrow('Currency mismatch');
      expect(() => brl.isGreaterThan(usd)).toThrow('Currency mismatch');
      expect(() => brl.isLessThan(usd)).toThrow('Currency mismatch');
    });
  });

  describe('comparison', () => {
    it('should compare monetary values', () => {
      const a = Money.create('20.00', 'BRL');
      const b = Money.create('10.00', 'BRL');

      expect(a.isGreaterThan(b)).toBe(true);
      expect(b.isLessThan(a)).toBe(true);
      expect(a.equals(b)).toBe(false);
      expect(a.equals(Money.create('20', 'BRL'))).toBe(true);
    });

    it('should distinguish different currencies', () => {
      const brl = Money.create('10.00', 'BRL');
      const usd = Money.create('10.00', 'USD');

      expect(brl.equals(usd)).toBe(false);
    });

    it('should identify positive, negative and zero values', () => {
      const positive = Money.create('10.00', 'BRL');
      const zero = Money.create('0', 'BRL');
      const negative = positive.negate();

      expect(positive.isPositive()).toBe(true);
      expect(zero.isZero()).toBe(true);
      expect(negative.isNegative()).toBe(true);
    });
  });

  describe('rehydrate', () => {
    it('should reconstruct a persisted value', () => {
      const money = Money.rehydrate('25.50', 'BRL');

      expect(money.toString()).toBe('25.50');
    });

    it('should reconstruct negative internal values', () => {
      const money = Money.rehydrate('-25.50', 'BRL');

      expect(money.toString()).toBe('-25.50');
    });

    it.each(['NaN', 'Infinity', '10.999'])(
      'should reject invalid persisted amount %s',
      (amount) => {
        expect(() => Money.rehydrate(amount, 'BRL')).toThrow(
          'Invalid monetary amount',
        );
      },
    );
  });

  describe('serialization and immutability', () => {
    it('should serialize money as decimal strings', () => {
      const money = Money.create('35.50', 'BRL');

      expect(money.toJSON()).toEqual({
        amount: '35.50',
        currency: 'BRL',
      });
    });

    it('should not modify the original value after arithmetic', () => {
      const original = Money.create('100.00', 'BRL');
      const result = original.subtract(Money.create('30.00', 'BRL'));

      expect(original.toString()).toBe('100.00');
      expect(result.toString()).toBe('70.00');
    });
  });
});
