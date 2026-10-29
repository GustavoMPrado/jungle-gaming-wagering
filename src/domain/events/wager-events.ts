import {
  IntegrationEvent,
  type IntegrationEventProps,
  type MoneyProps,
} from './integration-event.js';

export interface WagerTransactionProcessedData {
  transactionId: string;
  walletId: string;
  kind: string;
  money: MoneyProps;
}

export interface WagerTransactionRejectedData {
  transactionId: string;
  walletId: string;
  failureCode: string;
}

export interface WalletBalanceChangedData {
  transactionId: string;
  walletId: string;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
}

export interface WagerTransactionPendingReferenceData {
  transactionId: string;
  walletId: string;
  referenceExternalTransactionId: string;
  nextReferenceAttemptAt: string;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  public constructor(
    props: IntegrationEventProps<WagerTransactionProcessedData>,
  ) {
    super(props, 'WagerTransactionProcessed', 1);
  }
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  public constructor(
    props: IntegrationEventProps<WagerTransactionRejectedData>,
  ) {
    super(props, 'WagerTransactionRejected', 1);
  }
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  public constructor(
    props: IntegrationEventProps<WalletBalanceChangedData>,
  ) {
    super(props, 'WalletBalanceChanged', 1);
  }
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  public constructor(
    props: IntegrationEventProps<WagerTransactionPendingReferenceData>,
  ) {
    super(props, 'WagerTransactionPendingReference', 1);
  }
}
