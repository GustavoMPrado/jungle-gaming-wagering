import type { EntityManager } from '@mikro-orm/postgresql';
import {
  OutboxMessage,
} from '../../../domain/entities/outbox-message.js';
import {
  OutboxMessageRecord,
} from '../entities/outbox-message-record.entity.js';

export class OutboxMessageRepository {
  public constructor(
    private readonly em: EntityManager,
  ) {}

  public async findById(
    id: string,
  ): Promise<OutboxMessage | null> {
    const record = await this.em.findOne(
      OutboxMessageRecord,
      { id },
    );

    if (!record) {
      return null;
    }

    return OutboxMessage.rehydrate({
      id: record.id,
      aggregateId: record.aggregateId,
      eventType: record.eventType,
      payload: record.payload,
      occurredAt: record.occurredAt,
      attempts: record.attempts,
      nextAttemptAt: record.nextAttemptAt ?? undefined,
      publishedAt: record.publishedAt ?? undefined,
      claimToken: record.claimToken ?? undefined,
      lockedUntil: record.lockedUntil ?? undefined,
    });
  }

  public async enqueue(message: OutboxMessage): Promise<void> {
    const record = new OutboxMessageRecord();

    record.id = message.id;
    record.aggregateId = message.aggregateId;
    record.eventType = message.eventType;
    record.payload = message.payload;
    record.occurredAt = message.occurredAt;
    record.attempts = message.attempts;
    record.nextAttemptAt = message.nextAttemptAt;
    record.publishedAt = message.publishedAt;
    record.claimToken = message.claimToken;
    record.lockedUntil = message.lockedUntil;

    this.em.persist(record);
    await this.em.flush();
  }
}
