
import { Decimal } from 'decimal.js';

export class Money {
  private static readonly SCALE = 2;

  private constructor(
    private readonly amount: Decimal,
    public readonly currency: string,
  ) {}

  public static create(amount: string, currency: string): Money {
    Money.validateAmount(amount);
    Money.validateCurrency(currency);

    return new Money(new Decimal(amount), currency);
  }

  public static rehydrate(amount: string, currency: string): Money {
    Money.validateCurrency(currency);

    const decimal = new Decimal(amount);

    if (!decimal.isFinite() || decimal.decimalPlaces() > Money.SCALE) {
      throw new Error('Invalid monetary amount');
    }

    return new Money(decimal, currency);
  }

  private static validateAmount(amount: string): void {
    if (typeof amount !== 'string' || !/^\d+(\.\d{1,2})?$/.test(amount)) {
      throw new Error('Invalid monetary amount');
    }
  }

  private static validateCurrency(currency: string): void {
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
      throw new Error('Invalid currency');
    }
  }

  private ensureSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error('Currency mismatch');
    }
  }

  public add(other: Money): Money {
    this.ensureSameCurrency(other);

    return new Money(this.amount.plus(other.amount), this.currency);
  }

  public subtract(other: Money): Money {
    this.ensureSameCurrency(other);

    return new Money(this.amount.minus(other.amount), this.currency);
  }

  public negate(): Money {
    return new Money(this.amount.negated(), this.currency);
  }

  public equals(other: Money): boolean {
    return (
      this.currency === other.currency &&
      this.amount.equals(other.amount)
    );
  }

  public isNegative(): boolean {
    return this.amount.isNegative();
  }

  public isZero(): boolean {
    return this.amount.isZero();
  }

  public isPositive(): boolean {
    return this.amount.isPositive();
  }

  public isGreaterThan(other: Money): boolean {
    this.ensureSameCurrency(other);

    return this.amount.greaterThan(other.amount);
  }

  public isLessThan(other: Money): boolean {
    this.ensureSameCurrency(other);

    return this.amount.lessThan(other.amount);
  }

  public toString(): string {
    return this.amount.toFixed(Money.SCALE);
  }

  public toJSON(): { amount: string; currency: string } {
    return {
      amount: this.toString(),
      currency: this.currency,
    };
  }
}
