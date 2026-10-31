import { setTimeout as sleep } from 'node:timers/promises';

import {
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import type {
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { MikroORM } from '@mikro-orm/postgresql';

import {
  OutboxMessage,
} from '../../domain/entities/outbox-message.js';
import {
  OutboxMessageRepository,
} from '../persistence/repository/outbox-message.repository.js';

export class SqsOutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private running = false;
  private publishing?: Promise<void>;

  public constructor(
    private readonly orm: MikroORM,
    private readonly sqs: SQSClient,
    private readonly queueUrl: string,
  ) {}

  public onModuleInit(): void {
    this.running = true;
    this.publishing = this.poll();
  }

  public async onModuleDestroy(): Promise<void> {
    this.running = false;
    await this.publishing;
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const repository = new OutboxMessageRepository(
          this.orm.em.fork(),
        );

        const messages = await repository.claimPending(1);

        if (messages.length === 0) {
          await sleep(1000);
          continue;
        }

        for (const message of messages) {
          await this.publishMessage(message);
        }
      } catch (error) {
        this.log('outbox_poll_error', {
          error: this.errorMessage(error),
        });

        if (this.running) {
          await sleep(1000);
        }
      }
    }
  }

  private async publishMessage(
    message: OutboxMessage,
  ): Promise<void> {
    const token = message.claimToken;

    if (!token) {
      throw new Error('Outbox claim token is missing');
    }

    try {
      await this.sqs.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify(message.payload),
          MessageGroupId: message.aggregateId,
          MessageDeduplicationId: message.id,
        }),
      );

      const repository = new OutboxMessageRepository(
        this.orm.em.fork(),
      );

      const published = await repository.markPublished(
        message.id,
        token,
      );

      if (!published) {
        this.log('outbox_claim_lost', {
          eventId: message.id,
          eventType: message.eventType,
          aggregateId: message.aggregateId,
        });

        return;
      }

      this.log('outbox_event_published', {
        eventId: message.id,
        eventType: message.eventType,
        aggregateId: message.aggregateId,
      });
    } catch (error) {
      this.log('outbox_publish_error', {
        eventId: message.id,
        eventType: message.eventType,
        aggregateId: message.aggregateId,
        error: this.errorMessage(error),
      });

      await this.scheduleRetry(message, token);
    }
  }

  private async scheduleRetry(
    message: OutboxMessage,
    token: string,
  ): Promise<void> {
    const delaySeconds = Math.min(
      5 * Math.pow(2, Math.min(message.attempts, 6)),
      300,
    );

    const nextAttemptAt = new Date(
      Date.now() + delaySeconds * 1000,
    );

    try {
      const repository = new OutboxMessageRepository(
        this.orm.em.fork(),
      );

      const scheduled = await repository.scheduleRetry(
        message.id,
        token,
        nextAttemptAt,
      );

      if (!scheduled) {
        this.log('outbox_retry_claim_lost', {
          eventId: message.id,
        });

        return;
      }

      this.log('outbox_retry_scheduled', {
        eventId: message.id,
        delaySeconds,
        nextAttemptAt: nextAttemptAt.toISOString(),
      });
    } catch (error) {
      this.log('outbox_retry_error', {
        eventId: message.id,
        error: this.errorMessage(error),
      });
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error
      ? error.message
      : 'Unknown error';
  }

  private log(
    event: string,
    details: Record<string, unknown>,
  ): void {
    console.log(JSON.stringify({
      event,
      publisher: 'sqs-outbox-publisher',
      ...details,
    }));
  }
}
