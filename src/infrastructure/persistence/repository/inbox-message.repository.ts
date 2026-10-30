import type { EntityManager } from '@mikro-orm/postgresql';

import {
  InboxMessage,
} from '../../../domain/entities/inbox-message.js';

import {
  InboxMessageRecord,
} from '../entities/inbox-message-record.entity.js';

export class InboxMessageRepository {
  public constructor(
    private readonly em: EntityManager,
  ) {}

  public async findById(
    consumerName: string,
    messageId: string,
  ): Promise<InboxMessage | null> {
    const record = await this.em.findOne(
      InboxMessageRecord,
      { consumerName, messageId },
    );

    if (!record) {
      return null;
    }

    return InboxMessage.rehydrate({
      messageId: record.messageId,
      consumerName: record.consumerName,
      payloadHash: record.payloadHash,
      receivedAt: record.receivedAt,
      processedAt: record.processedAt ?? undefined,
    });
  }

  public async save(message: InboxMessage): Promise<void> {
    const record = await this.em.findOne(
      InboxMessageRecord,
      {
        consumerName: message.consumerName,
        messageId: message.messageId,
      },
    );

    if (record) {
      record.processedAt = message.processedAt;
    } else {
      const newRecord = new InboxMessageRecord();

      newRecord.consumerName = message.consumerName;
      newRecord.messageId = message.messageId;
      newRecord.payloadHash = message.payloadHash;
      newRecord.receivedAt = message.receivedAt;
      newRecord.processedAt = message.processedAt;

      this.em.persist(newRecord);
    }

    await this.em.flush();
  }
}
