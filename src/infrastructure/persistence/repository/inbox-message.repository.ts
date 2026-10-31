import { LockMode } from '@mikro-orm/core';
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

  public async claim(message: InboxMessage): Promise<InboxMessage> {
    if (!this.em.isInTransaction()) {
      throw new Error('Inbox claim requires an active transaction');
    }

    await this.em.execute(
      `
        INSERT INTO inbox_messages (
          consumer_name,
          message_id,
          payload_hash,
          received_at
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT (consumer_name, message_id) DO NOTHING
      `,
      [
        message.consumerName,
        message.messageId,
        message.payloadHash,
        message.receivedAt,
      ],
    );

    const record = await this.em.findOneOrFail(
      InboxMessageRecord,
      {
        consumerName: message.consumerName,
        messageId: message.messageId,
      },
      {
        lockMode: LockMode.PESSIMISTIC_WRITE,
        refresh: true,
      },
    );

    if (record.payloadHash !== message.payloadHash) {
      throw new Error('Inbox message payload conflict');
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
      if (record.payloadHash !== message.payloadHash) {
        throw new Error('Inbox message payload conflict');
      }

      if (record.processedAt && !message.isProcessed()) {
        throw new Error('Cannot reopen a processed Inbox message');
      }

      if (message.isProcessed()) {
        record.processedAt = message.processedAt;
      }
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
