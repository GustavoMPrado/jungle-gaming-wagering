import { randomUUID } from 'node:crypto';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import type {
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { MikroORM } from '@mikro-orm/postgresql';

import {
  WagerTransactionKind,
} from '../../domain/entities/wager-transaction.js';
import {
  InboxMessage,
} from '../../domain/entities/inbox-message.js';
import {
  InboxMessageRepository,
} from '../persistence/repository/inbox-message.repository.js';
import {
  ProcessWagerTransactionUseCase,
} from '../../application/use-cases/wagering/process-wager-transaction.use-case.js';
import {
  createWagerPayloadHash,
  type WagerPayload,
} from '../../application/utils/wager-payload-hash.js';

interface WagerQueueMessage {
  messageId: string;
  idempotencyKey: string;
  payload: WagerPayload;
}

class InvalidSqsMessageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidSqsMessageError';
  }
}

export class SqsWagerConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly consumerName = 'wagering-consumer';
  private readonly receiveAbort = new AbortController();

  private running = false;
  private polling?: Promise<void>;

  public constructor(
    private readonly orm: MikroORM,
    private readonly sqs: SQSClient,
    private readonly queueUrl: string,
  ) {}

  public onModuleInit(): void {
    this.running = true;
    this.polling = this.poll();
  }

  public async onModuleDestroy(): Promise<void> {
    this.running = false;
    this.receiveAbort.abort();

    await this.polling;
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const response = await this.sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: 1,
            WaitTimeSeconds: 10,
            VisibilityTimeout: 60,
            MessageSystemAttributeNames: [
              'ApproximateReceiveCount',
            ],
          }),
          {
            abortSignal: this.receiveAbort.signal,
          },
        );

        for (const message of response.Messages ?? []) {
          await this.processMessage(message);
        }
      } catch (error) {
        if (!this.running) {
          break;
        }

        this.log('receive_error', {
          error: this.errorMessage(error),
        });

        await Bun.sleep(1000);
      }
    }
  }

  private async processMessage(message: Message): Promise<void> {
    const receiveCount = Number(
      message.Attributes?.ApproximateReceiveCount ?? '1',
    );

    let context: WagerQueueMessage | undefined;

    try {
      context = this.parseMessage(message.Body);

      const { messageId, idempotencyKey, payload } = context;

      let payloadHash: string;

      try {
        payloadHash = createWagerPayloadHash(payload);
      } catch {
        throw new InvalidSqsMessageError(
          'Invalid transaction money',
        );
      }

      const inboxMessage = InboxMessage.receive({
        messageId,
        consumerName: this.consumerName,
        payloadHash,
      });

      const result = await this.orm.em.fork().transactional(
        async (em) => {
          const inbox = new InboxMessageRepository(em);
          const claimed = await inbox.claim(inboxMessage);

          if (claimed.isProcessed()) {
            return {
              duplicate: true,
              status: 'ALREADY_PROCESSED',
              transactionId: undefined as string | undefined,
            };
          }

          const useCase = new ProcessWagerTransactionUseCase(em);

          const processed = await useCase.execute(
            {
              ...payload,
              transactionId: randomUUID(),
              idempotencyKey,
              payloadHash,
              correlationId: messageId,
            },
            em,
          );

          claimed.markProcessed();
          await inbox.save(claimed);

          return {
            duplicate: false,
            status: processed.status,
            transactionId: processed.transactionId,
          };
        },
      );

      this.log('transaction_committed', {
        messageId,
        transactionId: result.transactionId,
        walletId: payload.walletId,
        providerId: payload.providerId,
        correlationId: messageId,
        status: result.status,
        duplicate: result.duplicate,
      });

      // A transação PostgreSQL já foi confirmada.
      await this.acknowledge(message);

      this.log('message_acknowledged', {
        messageId,
        correlationId: messageId,
      });
    } catch (error) {
      const permanent = this.isPermanentError(error);

      this.log(
        permanent
          ? 'permanent_message_error'
          : 'transient_message_error',
        {
          messageId: context?.messageId ?? message.MessageId,
          walletId: context?.payload.walletId,
          providerId: context?.payload.providerId,
          correlationId: context?.messageId,
          receiveCount,
          error: this.errorMessage(error),
        },
      );

      if (!permanent && this.running) {
        await this.scheduleRetry(message, receiveCount);
      }

      // Não executar DeleteMessage em caso de falha.
      // O redrive do SQS encaminhará à DLQ após o limite.
    }
  }

  private isPermanentError(error: unknown): boolean {
    if (error instanceof InvalidSqsMessageError) {
      return true;
    }

    if (!(error instanceof Error)) {
      return false;
    }

    const permanentErrors = [
      'Inbox message payload conflict',
      'Idempotency conflict',
      'External transaction identifier conflict',
      'Wallet ownership or currency mismatch',
    ];

    return permanentErrors.includes(error.message);
  }

  private async scheduleRetry(
    message: Message,
    receiveCount: number,
  ): Promise<void> {
    if (!message.ReceiptHandle) {
      return;
    }

    const delaySeconds = Math.min(
      5 * Math.pow(2, Math.max(0, receiveCount - 1)),
      60,
    );

    try {
      await this.sqs.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: this.queueUrl,
          ReceiptHandle: message.ReceiptHandle,
          VisibilityTimeout: delaySeconds,
        }),
      );

      this.log('message_retry_scheduled', {
        messageId: message.MessageId,
        receiveCount,
        delaySeconds,
      });
    } catch (error) {
      this.log('retry_scheduling_failed', {
        messageId: message.MessageId,
        error: this.errorMessage(error),
      });
    }
  }

  private async acknowledge(message: Message): Promise<void> {
    if (!message.ReceiptHandle) {
      throw new Error('SQS receipt handle is missing');
    }

    await this.sqs.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );
  }

  private parseMessage(
    body: string | undefined,
  ): WagerQueueMessage {
    if (!body) {
      throw new InvalidSqsMessageError('Empty SQS message');
    }

    let envelope: unknown;

    try {
      envelope = JSON.parse(body);
    } catch {
      throw new InvalidSqsMessageError('Invalid JSON message');
    }

    if (!this.isObject(envelope)) {
      throw new InvalidSqsMessageError(
        'Invalid SQS message envelope',
      );
    }

    const messageId = this.requiredString(
      envelope.messageId,
      'messageId',
    );

    if (envelope.type !== 'WagerTransactionRequested') {
      throw new InvalidSqsMessageError(
        'Invalid SQS message type',
      );
    }

    const occurredAt = this.requiredString(
      envelope.occurredAt,
      'occurredAt',
    );

    if (Number.isNaN(Date.parse(occurredAt))) {
      throw new InvalidSqsMessageError('Invalid occurredAt');
    }

    if (!this.isObject(envelope.data)) {
      throw new InvalidSqsMessageError(
        'Invalid SQS message data',
      );
    }

    const data = envelope.data;

    if (!this.isObject(data.money)) {
      throw new InvalidSqsMessageError('Invalid money object');
    }

    const allowedKinds = [
      WagerTransactionKind.Bet,
      WagerTransactionKind.Win,
      WagerTransactionKind.Loss,
      WagerTransactionKind.Refund,
      WagerTransactionKind.Rollback,
    ];

    if (!allowedKinds.includes(data.kind as WagerTransactionKind)) {
      throw new InvalidSqsMessageError(
        'Invalid transaction kind',
      );
    }

    const kind = data.kind as WagerTransactionKind;

    let referenceExternalTransactionId: string | undefined;

    if (data.referenceExternalTransactionId !== undefined) {
      referenceExternalTransactionId = this.requiredString(
        data.referenceExternalTransactionId,
        'referenceExternalTransactionId',
      );
    }

    if (
      (
        kind === WagerTransactionKind.Refund ||
        kind === WagerTransactionKind.Rollback
      ) &&
      !referenceExternalTransactionId
    ) {
      throw new InvalidSqsMessageError(
        'Reference transaction is required',
      );
    }

    const walletId = this.requiredString(
      data.walletId,
      'walletId',
    );

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(walletId)) {
      throw new InvalidSqsMessageError('Invalid wallet ID');
    }

    const payload: WagerPayload = {
      providerId: this.requiredString(
        data.providerId,
        'providerId',
      ),
      externalTransactionId: this.requiredString(
        data.externalTransactionId,
        'externalTransactionId',
      ),
      playerId: this.requiredString(
        data.playerId,
        'playerId',
      ),
      walletId,
      roundId: this.requiredString(
        data.roundId,
        'roundId',
      ),
      gameId: this.requiredString(
        data.gameId,
        'gameId',
      ),
      kind,
      amount: this.requiredString(
        data.money.amount,
        'money.amount',
      ),
      currency: this.requiredString(
        data.money.currency,
        'money.currency',
      ),
      referenceExternalTransactionId,
    };

    return {
      messageId,
      idempotencyKey: this.requiredString(
        data.idempotencyKey,
        'idempotencyKey',
      ),
      payload,
    };
  }

  private requiredString(
    value: unknown,
    field: string,
  ): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new InvalidSqsMessageError(
        `Invalid or missing field: ${field}`,
      );
    }

    return value.trim();
  }

  private isObject(
    value: unknown,
  ): value is Record<string, unknown> {
    return (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    );
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
      consumer: this.consumerName,
      ...details,
    }));
  }
}

