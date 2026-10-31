import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';

import ormConfig from '../../../src/mikro-orm.config.js';
import {
  InboxMessage,
} from '../../../src/domain/entities/inbox-message.js';
import {
  InboxMessageRepository,
} from '../../../src/infrastructure/persistence/repository/inbox-message.repository.js';

describe('InboxMessageRepository integration', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init(ormConfig);
  });

  afterAll(async () => {
    if (orm) {
      await orm.close();
    }
  });

  it('should persist and retrieve an inbox message', async () => {
    const messageId = crypto.randomUUID();
    const consumerName = 'wagering-consumer';

    const message = InboxMessage.receive({
      messageId,
      consumerName,
      payloadHash: 'hash-original',
    });

    const repository = new InboxMessageRepository(orm.em.fork());

    await repository.save(message);

    const stored = await new InboxMessageRepository(
      orm.em.fork(),
    ).findById(consumerName, messageId);

    expect(stored).not.toBeNull();
    expect(stored?.messageId).toBe(messageId);
    expect(stored?.consumerName).toBe(consumerName);
    expect(stored?.payloadHash).toBe('hash-original');
    expect(stored?.isProcessed()).toBe(false);
  });

  it('should mark a persisted message as processed', async () => {
    const messageId = crypto.randomUUID();
    const consumerName = 'wagering-consumer';

    const message = InboxMessage.receive({
      messageId,
      consumerName,
      payloadHash: 'hash-processed',
    });

    const repository = new InboxMessageRepository(orm.em.fork());

    await repository.save(message);

    message.markProcessed();

    await repository.save(message);

    const stored = await new InboxMessageRepository(
      orm.em.fork(),
    ).findById(consumerName, messageId);

    expect(stored?.isProcessed()).toBe(true);
    expect(stored?.processedAt).toBeInstanceOf(Date);
  });

  it('should return null when the message does not exist', async () => {
    const repository = new InboxMessageRepository(orm.em.fork());

    const result = await repository.findById(
      'wagering-consumer',
      crypto.randomUUID(),
    );

    expect(result).toBeNull();
  });

  it('should prevent duplicate records for the same consumer and message', async () => {
    const messageId = crypto.randomUUID();
    const consumerName = 'wagering-consumer';

    const first = InboxMessage.receive({
      messageId,
      consumerName,
      payloadHash: 'hash-original',
    });

    await new InboxMessageRepository(orm.em.fork()).save(first);

    const duplicate = InboxMessage.receive({
      messageId,
      consumerName,
      payloadHash: 'hash-original',
    });

    await new InboxMessageRepository(orm.em.fork()).save(duplicate);

    const records = await orm.em.fork().getConnection().execute<
      { count: string }[]
    >(
      `select count(*) as count
       from inbox_messages
       where consumer_name = ?
         and message_id = ?`,
      [consumerName, messageId],
    );

    expect(Number(records[0]?.count)).toBe(1);
  });

  it('should keep messages from different consumers separate', async () => {
    const messageId = crypto.randomUUID();

    const first = InboxMessage.receive({
      messageId,
      consumerName: 'wagering-consumer',
      payloadHash: 'hash-shared',
    });

    const second = InboxMessage.receive({
      messageId,
      consumerName: 'audit-consumer',
      payloadHash: 'hash-shared',
    });

    await new InboxMessageRepository(orm.em.fork()).save(first);
    await new InboxMessageRepository(orm.em.fork()).save(second);

    const repository = new InboxMessageRepository(orm.em.fork());

    const firstStored = await repository.findById(
      'wagering-consumer',
      messageId,
    );

    const secondStored = await repository.findById(
      'audit-consumer',
      messageId,
    );

    expect(firstStored).not.toBeNull();
    expect(secondStored).not.toBeNull();
    expect(firstStored?.consumerName).toBe('wagering-consumer');
    expect(secondStored?.consumerName).toBe('audit-consumer');
  });

  it('should claim a new message inside a transaction', async () => {
    const messageId = crypto.randomUUID();
    const consumerName = 'wagering-consumer';

    const message = InboxMessage.receive({
      messageId,
      consumerName,
      payloadHash: 'hash-new-claim',
    });

    await orm.em.fork().transactional(async (em) => {
      const repository = new InboxMessageRepository(em);

      const claimed = await repository.claim(message);

      expect(claimed.messageId).toBe(messageId);
      expect(claimed.payloadHash).toBe('hash-new-claim');
      expect(claimed.isProcessed()).toBe(false);

      claimed.markProcessed();
      await repository.save(claimed);
    });

    const stored = await new InboxMessageRepository(
      orm.em.fork(),
    ).findById(consumerName, messageId);

    expect(stored?.isProcessed()).toBe(true);
  });

  it('should recognize an already processed duplicate', async () => {
    const messageId = crypto.randomUUID();
    const consumerName = 'wagering-consumer';

    const message = InboxMessage.receive({
      messageId,
      consumerName,
      payloadHash: 'hash-duplicate',
    });

    await orm.em.fork().transactional(async (em) => {
      const repository = new InboxMessageRepository(em);

      const claimed = await repository.claim(message);

      claimed.markProcessed();
      await repository.save(claimed);
    });

    const duplicate = InboxMessage.receive({
      messageId,
      consumerName,
      payloadHash: 'hash-duplicate',
    });

    await orm.em.fork().transactional(async (em) => {
      const repository = new InboxMessageRepository(em);

      const claimed = await repository.claim(duplicate);

      expect(claimed.isProcessed()).toBe(true);
      expect(claimed.payloadHash).toBe('hash-duplicate');
    });

    const records = await orm.em.fork().getConnection().execute<
      { count: string }[]
    >(
      `select count(*) as count
       from inbox_messages
       where consumer_name = ?
         and message_id = ?`,
      [consumerName, messageId],
    );

    expect(Number(records[0]?.count)).toBe(1);
  });

  it('should reject a duplicate message with a different payload', async () => {
    const messageId = crypto.randomUUID();
    const consumerName = 'wagering-consumer';

    const original = InboxMessage.receive({
      messageId,
      consumerName,
      payloadHash: 'hash-original',
    });

    await orm.em.fork().transactional(async (em) => {
      const repository = new InboxMessageRepository(em);

      const claimed = await repository.claim(original);

      claimed.markProcessed();
      await repository.save(claimed);
    });

    const conflicting = InboxMessage.receive({
      messageId,
      consumerName,
      payloadHash: 'hash-different',
    });

    await expect(
      orm.em.fork().transactional(async (em) => {
        const repository = new InboxMessageRepository(em);

        await repository.claim(conflicting);
      }),
    ).rejects.toThrow('Inbox message payload conflict');

    const stored = await new InboxMessageRepository(
      orm.em.fork(),
    ).findById(consumerName, messageId);

    expect(stored?.payloadHash).toBe('hash-original');
    expect(stored?.isProcessed()).toBe(true);
  });

  it('should serialize concurrent claims for the same message', async () => {
    const messageId = crypto.randomUUID();
    const consumerName = 'wagering-consumer';

    const message = InboxMessage.receive({
      messageId,
      consumerName,
      payloadHash: 'hash-concurrent',
    });

    let releaseFirst!: () => void;
    let firstClaimed!: () => void;

    const firstHasClaimed = new Promise<void>((resolve) => {
      firstClaimed = resolve;
    });

    const releaseFirstTransaction = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const firstTransaction = orm.em.fork().transactional(async (em) => {
      const repository = new InboxMessageRepository(em);
      const claimed = await repository.claim(message);

      firstClaimed();
      await releaseFirstTransaction;

      claimed.markProcessed();
      await repository.save(claimed);

      return claimed.isProcessed();
    });

    await firstHasClaimed;

    const secondTransaction = orm.em.fork().transactional(async (em) => {
      const repository = new InboxMessageRepository(em);
      const claimed = await repository.claim(message);

      return claimed.isProcessed();
    });

    releaseFirst();

    const [firstProcessed, secondSawProcessed] = await Promise.all([
      firstTransaction,
      secondTransaction,
    ]);

    expect(firstProcessed).toBe(true);
    expect(secondSawProcessed).toBe(true);

    const stored = await new InboxMessageRepository(
      orm.em.fork(),
    ).findById(consumerName, messageId);

    expect(stored?.isProcessed()).toBe(true);

    const records = await orm.em.fork().getConnection().execute<
      { count: string }[]
    >(
      `select count(*) as count
       from inbox_messages
       where consumer_name = ?
         and message_id = ?`,
      [consumerName, messageId],
    );

    expect(Number(records[0]?.count)).toBe(1);
  });
});