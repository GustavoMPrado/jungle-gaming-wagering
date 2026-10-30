import { DecimalType, EntitySchema } from '@mikro-orm/core';

export class WalletLedgerEntryRecord {
  id!: string;
  walletId!: string;
  transactionId!: string;
  direction!: string;
  amount!: string;
  currency!: string;
  balanceBefore!: string;
  balanceAfter!: string;
  createdAt!: Date;
}

export const WalletLedgerEntryRecordSchema = new EntitySchema({
  class: WalletLedgerEntryRecord,
  tableName: 'wallet_ledger_entries',
  properties: {
    id: { type: 'uuid', primary: true },
    walletId: { type: 'uuid', fieldName: 'wallet_id' },
    transactionId: {
      type: 'uuid',
      fieldName: 'transaction_id',
    },
    direction: { type: 'string' },
    amount: {
      type: DecimalType,
      columnType: 'numeric(20,2)',
    },
    currency: { type: 'string' },
    balanceBefore: {
      type: DecimalType,
      columnType: 'numeric(20,2)',
      fieldName: 'balance_before',
    },
    balanceAfter: {
      type: DecimalType,
      columnType: 'numeric(20,2)',
      fieldName: 'balance_after',
    },
    createdAt: {
      type: 'datetime',
      fieldName: 'created_at',
    },
  },
});
