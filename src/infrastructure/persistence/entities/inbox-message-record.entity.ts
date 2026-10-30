import { EntitySchema } from '@mikro-orm/core';

export class InboxMessageRecord {
  consumerName!: string;
  messageId!: string;
  payloadHash!: string;
  receivedAt!: Date;
  processedAt?: Date;
}

export const InboxMessageRecordSchema = new EntitySchema({
  class: InboxMessageRecord,
  tableName: 'inbox_messages',
  properties: {
    consumerName: {
      type: 'string',
      fieldName: 'consumer_name',
      primary: true,
    },
    messageId: {
      type: 'string',
      fieldName: 'message_id',
      primary: true,
    },
    payloadHash: {
      type: 'string',
      fieldName: 'payload_hash',
    },
    receivedAt: {
      type: 'datetime',
      fieldName: 'received_at',
    },
    processedAt: {
      type: 'datetime',
      fieldName: 'processed_at',
      nullable: true,
    },
  },
});
