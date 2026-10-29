
import { Money } from '../value-objects/money.js';

export interface WalletState {
  id: string;
  playerId: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  public static open(props: {
    id: string;
    playerId: string;
    initialBalance: Money;
    createdAt?: Date;
  }): Wallet {
    if (!props.id?.trim() || !props.playerId?.trim()) {
      throw new Error('Invalid wallet identification');
    }

    if (props.initialBalance.isNegative()) {
      throw new Error('Wallet balance cannot be negative');
    }

    const now = props.createdAt ?? new Date();

    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      new Date(now.getTime()),
      new Date(now.getTime()),
    );
  }

  public static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.balance.currency,
      state.balance,
      state.version,
      new Date(state.createdAt.getTime()),
      new Date(state.updatedAt.getTime()),
    );
  }

  public get balance(): Money {
    return this._balance;
  }

  public get version(): number {
    return this._version;
  }

  public get updatedAt(): Date {
    return new Date(this._updatedAt.getTime());
  }

  public debit(amount: Money, at: Date = new Date()): void {
    this.ensureSameCurrency(amount);
    this.ensurePositiveAmount(amount);

    if (this._balance.isLessThan(amount)) {
      throw new Error('Insufficient wallet balance');
    }

    this._balance = this._balance.subtract(amount);
    this._version++;
    this._updatedAt = new Date(at.getTime());
  }

  public credit(amount: Money, at: Date = new Date()): void {
    this.ensureSameCurrency(amount);
    this.ensurePositiveAmount(amount);

    this._balance = this._balance.add(amount);
    this._version++;
    this._updatedAt = new Date(at.getTime());
  }

  private ensureSameCurrency(amount: Money): void {
    if (this.currency !== amount.currency) {
      throw new Error('Currency mismatch');
    }
  }

  private ensurePositiveAmount(amount: Money): void {
    if (!amount.isPositive()) {
      throw new Error('Transaction amount must be positive');
    }
  }
}
