
import { Money } from '../value-objects/money.js';

export enum LedgerDirection {
  Debit = 'DEBIT',
  Credit = 'CREDIT',
}

export interface CreateWalletLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt?: Date;
}

export class WalletLedgerEntry {
  private readonly _createdAt: Date;

  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    createdAt: Date,
  ) {
    this._createdAt = new Date(createdAt.getTime());
  }

  public static create(
    props: CreateWalletLedgerEntryProps,
  ): WalletLedgerEntry {
    WalletLedgerEntry.validate(props);

    const createdAt = props.createdAt ?? new Date();

    return new WalletLedgerEntry(
      props.id,
      props.walletId,
      props.transactionId,
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
      createdAt,
    );
  }

  public static rehydrate(
    props: CreateWalletLedgerEntryProps,
  ): WalletLedgerEntry {
    WalletLedgerEntry.validate(props);

    const createdAt = props.createdAt ?? new Date();

    return new WalletLedgerEntry(
      props.id,
      props.walletId,
      props.transactionId,
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
      createdAt,
    );
  }

  public get createdAt(): Date {
    return new Date(this._createdAt.getTime());
  }

  public isBalanced(): boolean {
    if (
      this.direction !== LedgerDirection.Debit &&
      this.direction !== LedgerDirection.Credit
    ) {
      return false;
    }

    if (!this.money.isPositive()) {
      return false;
    }

    if (
      this.money.currency !== this.balanceBefore.currency ||
      this.money.currency !== this.balanceAfter.currency
    ) {
      return false;
    }

    if (
      this.balanceBefore.isNegative() ||
      this.balanceAfter.isNegative()
    ) {
      return false;
    }

    try {
      const expectedBalance =
        this.direction === LedgerDirection.Credit
          ? this.balanceBefore.add(this.money)
          : this.balanceBefore.subtract(this.money);

      return expectedBalance.equals(this.balanceAfter);
    } catch {
      return false;
    }
  }

  private static validate(
    props: CreateWalletLedgerEntryProps,
  ): void {
    if (
      !props.id?.trim() ||
      !props.walletId?.trim() ||
      !props.transactionId?.trim()
    ) {
      throw new Error('Invalid ledger identification');
    }

    if (
      props.direction !== LedgerDirection.Debit &&
      props.direction !== LedgerDirection.Credit
    ) {
      throw new Error('Invalid ledger direction');
    }

    if (!props.money.isPositive()) {
      throw new Error('Ledger amount must be positive');
    }

    if (
      props.money.currency !== props.balanceBefore.currency ||
      props.money.currency !== props.balanceAfter.currency
    ) {
      throw new Error('Currency mismatch');
    }

    if (
      props.balanceBefore.isNegative() ||
      props.balanceAfter.isNegative()
    ) {
      throw new Error('Ledger balance cannot be negative');
    }

    const expectedBalance =
      props.direction === LedgerDirection.Credit
        ? props.balanceBefore.add(props.money)
        : props.balanceBefore.subtract(props.money);

    if (!expectedBalance.equals(props.balanceAfter)) {
      throw new Error('Ledger balance mismatch');
    }

    if (
      props.createdAt !== undefined &&
      !Number.isFinite(props.createdAt.getTime())
    ) {
      throw new Error('Invalid ledger date');
    }
  }
}

