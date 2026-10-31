import { randomUUID } from 'node:crypto';
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

  public async claimPending(
    limit: number = 10,
  ): Promise<OutboxMessage[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Invalid outbox batch limit');
    }

    const token = randomUUID();

    const ids = await this.em.transactional(async (em) => {
      const rows = await em.execute<{ id: string }[]>(
        `
          UPDATE outbox_messages AS o
          SET
            claim_token = ?::uuid,
            locked_until = NOW() + INTERVAL '30 seconds'
          WHERE o.id IN (
            SELECT id
            FROM outbox_messages
            WHERE published_at IS NULL
              AND (
                next_attempt_at IS NULL
                OR next_attempt_at <= NOW()
              )
              AND (
                locked_until IS NULL
                OR locked_until <= NOW()
              )
            ORDER BY occurred_at, id
            FOR UPDATE SKIP LOCKED
            LIMIT ?
          )
          RETURNING o.id
        `,
        [token, limit],
      );

      return rows.map((row) => row.id);
    });

    const messages: OutboxMessage[] = [];

    for (const id of ids) {
      const message = await this.findById(id);

      if (message && message.claimToken === token) {
        messages.push(message);
      }
    }

    return messages;
  }

  public async markPublished(
    id: string,
    token: string,
    at: Date = new Date(),
  ): Promise<boolean> {
    if (!token.trim()) {
      throw new Error('Outbox claim token is required');
    }

    const rows = await this.em.execute<{ id: string }[]>(
      `
        UPDATE outbox_messages
        SET
          published_at = ?,
          claim_token = NULL,
          locked_until = NULL,
          next_attempt_at = NULL
        WHERE id = ?::uuid
          AND claim_token = ?::uuid
          AND published_at IS NULL
        RETURNING id
      `,
      [at, id, token],
    );

    return rows.length === 1;
  }

  public async scheduleRetry(
    id: string,
    token: string,
    nextAttemptAt: Date,
  ): Promise<boolean> {
    if (!token.trim()) {
      throw new Error('Outbox claim token is required');
    }

    if (!Number.isFinite(nextAttemptAt.getTime())) {
      throw new Error('Invalid retry date');
    }

    const rows = await this.em.execute<{ id: string }[]>(
      `
        UPDATE outbox_messages
        SET
          attempts = attempts + 1,
          next_attempt_at = ?,
          claim_token = NULL,
          locked_until = NULL
        WHERE id = ?::uuid
          AND claim_token = ?::uuid
          AND published_at IS NULL
        RETURNING id
      `,
      [nextAttemptAt, id, token],
    );

    return rows.length === 1;
  }
}
