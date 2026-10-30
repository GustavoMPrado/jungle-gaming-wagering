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
});
