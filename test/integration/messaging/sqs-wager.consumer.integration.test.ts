import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
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

describe('SQS wager consumer integration', () => {
  let orm: MikroORM;
  let sqs: SQSClient;
  let consumer: SqsWagerConsumer;

  const queueUrl =
    'http://localhost:4566/000000000000/wager-transactions.fifo';

  const dlqUrl =
    'http://localhost:4566/000000000000/wager-transactions-dlq.fifo';

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

    consumer = new SqsWagerConsumer(orm, sqs, queueUrl);
  });

  afterAll(async () => {
    if (consumer) {
      await consumer.onModuleDestroy();
    }

    if (sqs) {
      sqs.destroy();
    }

    if (orm) {
      await orm.close();
    }
  });

  async function createWallet(
    walletId: string,
    playerId: string,
  ): Promise<void> {
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
      [
        walletId,
        playerId,
        'BRL',
        '0.00',
        1,
      ],
    );
  }

  async function waitForInbox(
    messageId: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt++) {
      const inbox = await new InboxMessageRepository(
        orm.em.fork(),
      ).findById('wagering-consumer', messageId);

      if (inbox?.isProcessed()) {
        return;
      }

      await Bun.sleep(1000);
    }

    throw new Error('SQS message was not processed');
  }

  async function waitForEmptyQueue(): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt++) {
      const response = await sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: queueUrl,
          AttributeNames: [
            'ApproximateNumberOfMessages',
            'ApproximateNumberOfMessagesNotVisible',
          ],
        }),
      );

      const visible = Number(
        response.Attributes?.ApproximateNumberOfMessages ?? 0,
      );

      const notVisible = Number(
        response.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0,
      );

      if (visible === 0 && notVisible === 0) {
        return;
      }

      await Bun.sleep(1000);
    }

    throw new Error('SQS queue did not become empty');
  }

  async function getWalletBalance(
    walletId: string,
  ): Promise<string | undefined> {
    const records = await orm.em.fork().getConnection().execute<
      { balance: string }[]
    >(
      'SELECT balance FROM wallets WHERE id = ?',
      [walletId],
    );

    return records[0]?.balance;
  }

  it('should process and acknowledge a valid SQS message', async () => {
    const messageId = randomUUID();
    const walletId = randomUUID();
    const playerId = randomUUID();

    await createWallet(walletId, playerId);

    const message = {
      messageId,
      type: 'WagerTransactionRequested',
      occurredAt: new Date().toISOString(),
      data: {
        providerId: 'provider-integration',
        externalTransactionId: randomUUID(),
        idempotencyKey: randomUUID(),
        playerId,
        walletId,
        roundId: randomUUID(),
        gameId: 'integration-game',
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

    consumer.onModuleInit();

    await waitForInbox(messageId);

    expect(await getWalletBalance(walletId)).toBe('25.00');

    await waitForEmptyQueue();

    const inbox = await new InboxMessageRepository(
      orm.em.fork(),
    ).findById('wagering-consumer', messageId);

    expect(inbox?.isProcessed()).toBe(true);
  });

  it('should not credit the wallet twice on SQS redelivery', async () => {
    const messageId = randomUUID();
    const walletId = randomUUID();
    const playerId = randomUUID();
    const externalTransactionId = randomUUID();

    await createWallet(walletId, playerId);

    const message = {
      messageId,
      type: 'WagerTransactionRequested',
      occurredAt: new Date().toISOString(),
      data: {
        providerId: 'provider-integration',
        externalTransactionId,
        idempotencyKey: `provider-integration:${externalTransactionId}`,
        playerId,
        walletId,
        roundId: randomUUID(),
        gameId: 'integration-game',
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
        MessageDeduplicationId: randomUUID(),
      }),
    );

    await waitForInbox(messageId);
    await waitForEmptyQueue();

    expect(await getWalletBalance(walletId)).toBe('25.00');

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(message),
        MessageGroupId: walletId,
        MessageDeduplicationId: randomUUID(),
      }),
    );

    await waitForEmptyQueue();

    const balance = await getWalletBalance(walletId);

    const transactions = await orm.em.fork().getConnection().execute<
      { count: string }[]
    >(
      `SELECT COUNT(*) AS count
       FROM wager_transactions
       WHERE provider_id = ?
         AND external_transaction_id = ?`,
      [
        'provider-integration',
        externalTransactionId,
      ],
    );

    const inboxRecords = await orm.em.fork().getConnection().execute<
      { count: string }[]
    >(
      `SELECT COUNT(*) AS count
       FROM inbox_messages
       WHERE consumer_name = ?
         AND message_id = ?`,
      [
        'wagering-consumer',
        messageId,
      ],
    );

    const ledgerRecords = await orm.em.fork().getConnection().execute<
      { count: string }[]
    >(
      `SELECT COUNT(*) AS count
       FROM wallet_ledger_entries
       WHERE wallet_id = ?`,
      [walletId],
    );

    expect(balance).toBe('25.00');
    expect(Number(transactions[0]?.count)).toBe(1);
    expect(Number(inboxRecords[0]?.count)).toBe(1);
    expect(Number(ledgerRecords[0]?.count)).toBe(1);
  });

  it('should retry after rollback and process when the wallet becomes available', async () => {
    const messageId = randomUUID();
    const walletId = randomUUID();
    const playerId = randomUUID();
    const externalTransactionId = randomUUID();

    const message = {
      messageId,
      type: 'WagerTransactionRequested',
      occurredAt: new Date().toISOString(),
      data: {
        providerId: 'provider-integration',
        externalTransactionId,
        idempotencyKey: `provider-integration:${externalTransactionId}`,
        playerId,
        walletId,
        roundId: randomUUID(),
        gameId: 'integration-game',
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
        MessageDeduplicationId: randomUUID(),
      }),
    );

    await Bun.sleep(2500);

    const inboxBefore = await new InboxMessageRepository(
      orm.em.fork(),
    ).findById('wagering-consumer', messageId);

    const transactionsBefore = await orm.em.fork()
      .getConnection().execute<{ count: string }[]>(
        `SELECT COUNT(*) AS count
         FROM wager_transactions
         WHERE provider_id = ?
           AND external_transaction_id = ?`,
        ['provider-integration', externalTransactionId],
      );

    expect(inboxBefore).toBeNull();
    expect(Number(transactionsBefore[0]?.count)).toBe(0);

    await createWallet(walletId, playerId);

    await waitForInbox(messageId);
    await waitForEmptyQueue();

    expect(await getWalletBalance(walletId)).toBe('25.00');

    const inboxAfter = await new InboxMessageRepository(
      orm.em.fork(),
    ).findById('wagering-consumer', messageId);

    const ledger = await orm.em.fork()
      .getConnection().execute<{ count: string }[]>(
        `SELECT COUNT(*) AS count
         FROM wallet_ledger_entries
         WHERE wallet_id = ?`,
        [walletId],
      );

    const transactionsAfter = await orm.em.fork()
      .getConnection().execute<{ count: string }[]>(
        `SELECT COUNT(*) AS count
         FROM wager_transactions
         WHERE provider_id = ?
           AND external_transaction_id = ?`,
        ['provider-integration', externalTransactionId],
      );

    expect(inboxAfter?.isProcessed()).toBe(true);
    expect(Number(ledger[0]?.count)).toBe(1);
    expect(Number(transactionsAfter[0]?.count)).toBe(1);
  }, 30000);

  it('should move an invalid message to the DLQ after five receives', async () => {
    const messageId = randomUUID();
    const invalidBody = `invalid-json-${messageId}`;

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: invalidBody,
        MessageGroupId: messageId,
        MessageDeduplicationId: randomUUID(),
      }),
    );

    let foundInDlq = false;

    for (let attempt = 0; attempt < 330; attempt++) {
      const response = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: dlqUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
          VisibilityTimeout: 2,
        }),
      );

      for (const received of response.Messages ?? []) {
        if (received.Body !== invalidBody) {
          continue;
        }

        foundInDlq = true;

        if (received.ReceiptHandle) {
          await sqs.send(
            new DeleteMessageCommand({
              QueueUrl: dlqUrl,
              ReceiptHandle: received.ReceiptHandle,
            }),
          );
        }

        break;
      }

      if (foundInDlq) {
        break;
      }

      await Bun.sleep(1000);
    }

    expect(foundInDlq).toBe(true);

    const inbox = await new InboxMessageRepository(
      orm.em.fork(),
    ).findById('wagering-consumer', messageId);

    expect(inbox).toBeNull();
  }, 360000);
});
