import { EntitySchema, JsonType } from '@mikro-orm/core';

export class OutboxMessageRecord {
  id!: string;
  aggregateId!: string;
  eventType!: string;
  payload!: Record<string, unknown>;
  occurredAt!: Date;
  attempts!: number;
  nextAttemptAt?: Date;
  publishedAt?: Date;
  claimToken?: string;
  lockedUntil?: Date;
}

export const OutboxMessageRecordSchema = new EntitySchema({
  class: OutboxMessageRecord,
  tableName: 'outbox_messages',
  properties: {
    id: { type: 'uuid', primary: true },
    aggregateId: {
      type: 'string',
      fieldName: 'aggregate_id',
    },
    eventType: {
      type: 'string',
      fieldName: 'event_type',
    },
    payload: {
      type: JsonType,
      columnType: 'jsonb',
    },
    occurredAt: {
      type: 'datetime',
      fieldName: 'occurred_at',
    },
    attempts: {
      type: 'integer',
    },
    nextAttemptAt: {
      type: 'datetime',
      fieldName: 'next_attempt_at',
      nullable: true,
    },
    publishedAt: {
      type: 'datetime',
      fieldName: 'published_at',
      nullable: true,
    },
    claimToken: {
      type: 'uuid',
      fieldName: 'claim_token',
      nullable: true,
    },
    lockedUntil: {
      type: 'datetime',
      fieldName: 'locked_until',
      nullable: true,
    },
  },
});
