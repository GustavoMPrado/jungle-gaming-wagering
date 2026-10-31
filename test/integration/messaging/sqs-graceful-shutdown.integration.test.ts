import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { MikroORM } from '@mikro-orm/postgresql';

import ormConfig from '../../../src/mikro-orm.config.js';
import {
  SqsWagerConsumer,
} from '../../../src/infrastructure/messaging/sqs-wager.consumer.js';
import {
  InboxMessageRepository,
} from '../../../src/infrastructure/persistence/repository/inbox-message.repository.js';

describe('SQS graceful shutdown integration', () => {
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

    const response = await sqs.send(
      new CreateQueueCommand({
        QueueName: `jg-shutdown-${randomUUID()}.fifo`,
        Attributes: {
          FifoQueue: 'true',
          ContentBasedDeduplication: 'false',
        },
      }),
    );

    if (!response.QueueUrl) {
      throw new Error('Failed to create test queue');
    }

    queueUrl = response.QueueUrl;
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

  it('should finish an in-flight message before shutting down', async () => {
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

    let notifyAckStarted!: () => void;
    let releaseAck!: () => void;

    const ackStarted = new Promise<void>((resolve) => {
      notifyAckStarted = resolve;
    });

    const ackReleased = new Promise<void>((resolve) => {
      releaseAck = resolve;
    });

    let ackCompleted = false;
    let shutdownCompleted = false;

    sqs.middlewareStack.add(
      (next, context) => async (args) => {
        if (context.commandName === 'DeleteMessageCommand') {
          notifyAckStarted();

          await ackReleased;

          const result = await next(args);

          ackCompleted = true;

          return result;
        }

        return next(args);
      },
      {
        step: 'initialize',
        name: 'holdAckDuringShutdown',
      },
    );

    const message = {
      messageId,
      type: 'WagerTransactionRequested',
      occurredAt: new Date().toISOString(),
      data: {
        providerId: 'provider-shutdown-test',
        externalTransactionId,
        idempotencyKey:
          `provider-shutdown-test:${externalTransactionId}`,
        playerId,
        walletId,
        roundId: randomUUID(),
        gameId: 'shutdown-test',
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

    try {
      await Promise.race([
        ackStarted,
        Bun.sleep(10000).then(() => {
          throw new Error('ACK was not started');
        }),
      ]);

      const inboxBefore = await new InboxMessageRepository(
        orm.em.fork(),
      ).findById('wagering-consumer', messageId);

      expect(inboxBefore?.isProcessed()).toBe(true);

      const shutdown = consumer.onModuleDestroy().then(() => {
        shutdownCompleted = true;
      });

      await Bun.sleep(300);

      expect(shutdownCompleted).toBe(false);
      expect(ackCompleted).toBe(false);

      releaseAck();

      await shutdown;

      expect(ackCompleted).toBe(true);
      expect(shutdownCompleted).toBe(true);

      consumer = undefined;

      const connection = orm.em.fork().getConnection();

      const balances = await connection.execute<
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
        ['provider-shutdown-test', externalTransactionId],
      );

      const ledger = await connection.execute<
        { count: string }[]
      >(
        `SELECT COUNT(*) AS count
         FROM wallet_ledger_entries
         WHERE wallet_id = ?`,
        [walletId],
      );

      expect(balances[0]?.balance).toBe('25.00');
      expect(Number(transactions[0]?.count)).toBe(1);
      expect(Number(ledger[0]?.count)).toBe(1);
    } finally {
      releaseAck();
    }
  }, 20000);
});
