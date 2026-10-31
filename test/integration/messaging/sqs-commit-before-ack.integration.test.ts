import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  ChangeMessageVisibilityCommand,
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  SQSClient,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { MikroORM } from '@mikro-orm/postgresql';

import ormConfig from '../../../src/mikro-orm.config.js';
import {
  SqsWagerConsumer,
} from '../../../src/infrastructure/messaging/sqs-wager.consumer.js';
import {
  InboxMessageRepository,
} from '../../../src/infrastructure/persistence/repository/inbox-message.repository.js';

describe('SQS recovery after commit before ACK', () => {
  let orm: MikroORM;
  let sqs: SQSClient;
  let consumer: SqsWagerConsumer | undefined;
  let queueUrl: string;

  beforeAll(async () => {
    orm = await MikroORM.init(ormConfig);

    sqs = new SQSClient({
      region: 'us-east-1',
      endpoint: 'http://localhost:4566',
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
    });

    const created = await sqs.send(
      new CreateQueueCommand({
        QueueName: `jg-ack-test-${randomUUID()}.fifo`,
        Attributes: {
          FifoQueue: 'true',
          ContentBasedDeduplication: 'false',
        },
      }),
    );

    if (!created.QueueUrl) {
      throw new Error('Failed to create test queue');
    }

    queueUrl = created.QueueUrl;
  });

  afterAll(async () => {
    try {
      if (consumer) {
        await consumer.onModuleDestroy();
      }
    } finally {
      try {
        if (sqs && queueUrl) {
          await sqs.send(
            new DeleteQueueCommand({
              QueueUrl: queueUrl,
            }),
          );
        }
      } finally {
        sqs?.destroy();
        await orm?.close();
      }
    }
  });

  async function waitFor(
    condition: () => Promise<boolean>,
    timeoutMs = 20000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (await condition()) {
        return;
      }

      await Bun.sleep(200);
    }

    throw new Error('Timed out waiting for condition');
  }

  it('should not duplicate financial effects after ACK failure and consumer restart', async () => {
    const messageId = randomUUID();
    const walletId = randomUUID();
    const playerId = randomUUID();
    const externalTransactionId = randomUUID();

    await orm.em.fork().getConnection().execute(
      `INSERT INTO wallets (
        id,
        player_id,
        currency,
        balance,
        version,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
      [walletId, playerId, 'BRL', '0.00', 1],
    );

    let failFirstAck = true;
    let failedAckReceiptHandle: string | undefined;
    let secondAckSucceeded = false;
    let signalAckAttempt!: () => void;

    const ackAttempted = new Promise<void>((resolve) => {
      signalAckAttempt = resolve;
    });

    sqs.middlewareStack.add(
      (next, context) => async (args) => {
        if (context.commandName === 'DeleteMessageCommand') {
          const input = args.input as {
            ReceiptHandle?: string;
          };

          if (failFirstAck) {
            failFirstAck = false;
            failedAckReceiptHandle = input.ReceiptHandle;
            signalAckAttempt();

            throw new Error('Simulated ACK failure after commit');
          }

          const result = await next(args);
          secondAckSucceeded = true;

          return result;
        }

        return next(args);
      },
      {
        step: 'initialize',
        name: 'simulateAckFailure',
      },
    );

    const message = {
      messageId,
      type: 'WagerTransactionRequested',
      occurredAt: new Date().toISOString(),
      data: {
        providerId: 'provider-ack-recovery',
        externalTransactionId,
        idempotencyKey:
          `provider-ack-recovery:${externalTransactionId}`,
        playerId,
        walletId,
        roundId: randomUUID(),
        gameId: 'ack-recovery-game',
        kind: 'WIN',
        money: {
          amount: '25.00',
          currency: 'BRL',
        },
      },
    };

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(message),
        MessageGroupId: walletId,
        MessageDeduplicationId: messageId,
      }),
    );

    consumer = new SqsWagerConsumer(orm, sqs, queueUrl);
    consumer.onModuleInit();

    await Promise.race([
      ackAttempted,
      Bun.sleep(15000).then(() => {
        throw new Error('ACK was not attempted');
      }),
    ]);

    await consumer.onModuleDestroy();
    consumer = undefined;

    const connection = orm.em.fork().getConnection();

    const inboxBefore = await new InboxMessageRepository(
      orm.em.fork(),
    ).findById('wagering-consumer', messageId);

    const balanceBefore = await connection.execute<
      { balance: string }[]
    >(
      'SELECT balance FROM wallets WHERE id = ?',
      [walletId],
    );

    expect(inboxBefore?.isProcessed()).toBe(true);
    expect(balanceBefore[0]?.balance).toBe('25.00');
    expect(failFirstAck).toBe(false);

    if (!failedAckReceiptHandle) {
      throw new Error('Missing receipt handle after failed ACK');
    }

    await sqs.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: failedAckReceiptHandle,
        VisibilityTimeout: 0,
      }),
    );

    consumer = new SqsWagerConsumer(orm, sqs, queueUrl);
    consumer.onModuleInit();

    await waitFor(async () => {
      return secondAckSucceeded;
    });

    await waitFor(async () => {
      const attributes = await sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: queueUrl,
          AttributeNames: [
            'ApproximateNumberOfMessages',
            'ApproximateNumberOfMessagesNotVisible',
          ],
        }),
      );

      const visible = Number(
        attributes.Attributes?.ApproximateNumberOfMessages ?? 0,
      );

      const notVisible = Number(
        attributes.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0,
      );

      return visible === 0 && notVisible === 0;
    });

    const balanceAfter = await connection.execute<
      { balance: string }[]
    >(
      'SELECT balance FROM wallets WHERE id = ?',
      [walletId],
    );

    const transactions = await connection.execute<
      { count: string }[]
    >(
      `SELECT COUNT(*) AS count
       FROM wager_transactions
       WHERE provider_id = ?
         AND external_transaction_id = ?`,
      ['provider-ack-recovery', externalTransactionId],
    );

    const ledger = await connection.execute<
      { count: string }[]
    >(
      `SELECT COUNT(*) AS count
       FROM wallet_ledger_entries
       WHERE wallet_id = ?`,
      [walletId],
    );

    const inbox = await connection.execute<
      { count: string }[]
    >(
      `SELECT COUNT(*) AS count
       FROM inbox_messages
       WHERE consumer_name = ?
         AND message_id = ?`,
      ['wagering-consumer', messageId],
    );

    expect(secondAckSucceeded).toBe(true);
    expect(balanceAfter[0]?.balance).toBe('25.00');
    expect(Number(transactions[0]?.count)).toBe(1);
    expect(Number(ledger[0]?.count)).toBe(1);
    expect(Number(inbox[0]?.count)).toBe(1);
  }, 30000);
});
