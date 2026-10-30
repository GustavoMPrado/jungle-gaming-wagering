import { DecimalType, EntitySchema } from '@mikro-orm/core';

export class WagerTransactionRecord {
  id!: string;
  providerId!: string;
  externalTransactionId!: string;
  idempotencyKey!: string;
  payloadHash!: string;
  walletId!: string;
  playerId!: string;
  roundId!: string;
  gameId!: string;
  kind!: string;
  amount!: string;
  currency!: string;
  status!: string;
  referenceExternalTransactionId?: string;
  referenceTransactionId?: string;
  failureCode?: string;
  resultBalance?: string;
  referenceAttempts!: number;
  nextReferenceAttemptAt?: Date;
  createdAt!: Date;
  processedAt?: Date;
}

export const WagerTransactionRecordSchema = new EntitySchema({
  class: WagerTransactionRecord,
  tableName: 'wager_transactions',
  properties: {
    id: { type: 'uuid', primary: true },
    providerId: { type: 'string', fieldName: 'provider_id' },
    externalTransactionId: {
      type: 'string',
      fieldName: 'external_transaction_id',
    },
    idempotencyKey: {
      type: 'string',
      fieldName: 'idempotency_key',
    },
    payloadHash: { type: 'string', fieldName: 'payload_hash' },
    walletId: { type: 'uuid', fieldName: 'wallet_id' },
    playerId: { type: 'string', fieldName: 'player_id' },
    roundId: { type: 'string', fieldName: 'round_id' },
    gameId: { type: 'string', fieldName: 'game_id' },
    kind: { type: 'string' },
    amount: { type: DecimalType, columnType: 'numeric(20,2)' },
    currency: { type: 'string' },
    status: { type: 'string' },
    referenceExternalTransactionId: {
      type: 'string',
      fieldName: 'reference_external_transaction_id',
      nullable: true,
    },
    referenceTransactionId: {
      type: 'uuid',
      fieldName: 'reference_transaction_id',
      nullable: true,
    },
    failureCode: {
      type: 'string',
      fieldName: 'failure_code',
      nullable: true,
    },
    resultBalance: {
      type: DecimalType,
      columnType: 'numeric(20,2)',
      fieldName: 'result_balance',
      nullable: true,
    },
    referenceAttempts: {
      type: 'integer',
      fieldName: 'reference_attempts',
    },
    nextReferenceAttemptAt: {
      type: 'datetime',
      fieldName: 'next_reference_attempt_at',
      nullable: true,
    },
    createdAt: { type: 'datetime', fieldName: 'created_at' },
    processedAt: {
      type: 'datetime',
      fieldName: 'processed_at',
      nullable: true,
    },
  },
});
