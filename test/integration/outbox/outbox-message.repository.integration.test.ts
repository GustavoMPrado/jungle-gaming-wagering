import { randomUUID } from 'node:crypto';
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
  OutboxMessage,
} from '../../../src/domain/entities/outbox-message.js';
import {
  OutboxMessageRepository,
} from '../../../src/infrastructure/persistence/repository/outbox-message.repository.js';

describe('OutboxMessageRepository integration', () => {
  let orm: MikroORM;

  const createdIds: string[] = [];

  beforeAll(async () => {
    orm = await MikroORM.init(ormConfig);
  });

  afterAll(async () => {
    if (orm) {
      for (const id of createdIds) {
        await orm.em.fork().getConnection().execute(
          'DELETE FROM outbox_messages WHERE id = ?::uuid',
          [id],
        );
      }

      await orm.close();
    }
  });

  async function createMessage(): Promise<OutboxMessage> {
    const id = randomUUID();

    const message = OutboxMessage.enqueue({
      id,
      aggregateId: randomUUID(),
      eventType: 'WalletBalanceChanged',
      payload: {
        eventId: id,
        eventType: 'WalletBalanceChanged',
        version: 1,
      },
      occurredAt: new Date('2000-01-01T00:00:00.000Z'),
    });

    await new OutboxMessageRepository(
      orm.em.fork(),
    ).enqueue(message);

    createdIds.push(id);

    return message;
  }

  it('should persist and retrieve an outbox message', async () => {
    const message = await createMessage();

    const stored = await new OutboxMessageRepository(
      orm.em.fork(),
    ).findById(message.id);

    expect(stored).not.toBeNull();
    expect(stored?.id).toBe(message.id);
    expect(stored?.eventType).toBe('WalletBalanceChanged');
    expect(stored?.attempts).toBe(0);
    expect(stored?.isPending()).toBe(true);
  });

  it('should claim a pending message', async () => {
    const message = await createMessage();

    const repository = new OutboxMessageRepository(orm.em.fork());

    const claimed = await repository.claimPending(100);
    const selected = claimed.find((item) => item.id === message.id);

    expect(selected).toBeDefined();
    expect(selected?.claimToken).toBeDefined();
    expect(selected?.lockedUntil).toBeInstanceOf(Date);

    const stored = await new OutboxMessageRepository(
      orm.em.fork(),
    ).findById(message.id);

    expect(stored?.claimToken).toBe(selected?.claimToken);
  });

  it('should prevent concurrent publishers from claiming the same message', async () => {
    const message = await createMessage();

    const firstRepository = new OutboxMessageRepository(
      orm.em.fork(),
    );

    const secondRepository = new OutboxMessageRepository(
      orm.em.fork(),
    );

    const [firstBatch, secondBatch] = await Promise.all([
      firstRepository.claimPending(100),
      secondRepository.claimPending(100),
    ]);

    const firstClaimed = firstBatch.some(
      (item) => item.id === message.id,
    );

    const secondClaimed = secondBatch.some(
      (item) => item.id === message.id,
    );

    expect(Number(firstClaimed) + Number(secondClaimed)).toBe(1);

    const firstIds = new Set(firstBatch.map((item) => item.id));

    for (const item of secondBatch) {
      expect(firstIds.has(item.id)).toBe(false);
    }
  });

  it('should mark a claimed message as published', async () => {
    const message = await createMessage();

    const repository = new OutboxMessageRepository(
      orm.em.fork(),
    );

    const claimed = await repository.claimPending(100);
    const selected = claimed.find((item) => item.id === message.id);

    expect(selected?.claimToken).toBeDefined();

    const published = await new OutboxMessageRepository(
      orm.em.fork(),
    ).markPublished(message.id, selected!.claimToken!);

    expect(published).toBe(true);

    const stored = await new OutboxMessageRepository(
      orm.em.fork(),
    ).findById(message.id);

    expect(stored?.isPending()).toBe(false);
    expect(stored?.publishedAt).toBeInstanceOf(Date);
    expect(stored?.claimToken).toBeUndefined();
    expect(stored?.lockedUntil).toBeUndefined();
  });

  it('should reject publication with an incorrect claim token', async () => {
    const message = await createMessage();

    const repository = new OutboxMessageRepository(
      orm.em.fork(),
    );

    const claimed = await repository.claimPending(100);

    expect(claimed.some((item) => item.id === message.id)).toBe(true);

    const result = await new OutboxMessageRepository(
      orm.em.fork(),
    ).markPublished(message.id, randomUUID());

    expect(result).toBe(false);

    const stored = await new OutboxMessageRepository(
      orm.em.fork(),
    ).findById(message.id);

    expect(stored?.isPending()).toBe(true);
  });

  it('should schedule a retry after publication failure', async () => {
    const message = await createMessage();

    const repository = new OutboxMessageRepository(
      orm.em.fork(),
    );

    const claimed = await repository.claimPending(100);
    const selected = claimed.find((item) => item.id === message.id);

    expect(selected?.claimToken).toBeDefined();

    const nextAttemptAt = new Date(
      Date.now() + 60_000,
    );

    const scheduled = await new OutboxMessageRepository(
      orm.em.fork(),
    ).scheduleRetry(
      message.id,
      selected!.claimToken!,
      nextAttemptAt,
    );

    expect(scheduled).toBe(true);

    const stored = await new OutboxMessageRepository(
      orm.em.fork(),
    ).findById(message.id);

    expect(stored?.attempts).toBe(1);
    expect(stored?.nextAttemptAt?.getTime()).toBe(
      nextAttemptAt.getTime(),
    );
    expect(stored?.claimToken).toBeUndefined();
    expect(stored?.lockedUntil).toBeUndefined();
    expect(stored?.isDue()).toBe(false);
  });

  it('should allow another publisher to reclaim an expired lease', async () => {
    const message = await createMessage();

    const firstRepository = new OutboxMessageRepository(
      orm.em.fork(),
    );

    const firstBatch = await firstRepository.claimPending(100);
    const firstClaim = firstBatch.find(
      (item) => item.id === message.id,
    );

    expect(firstClaim?.claimToken).toBeDefined();

    await orm.em.fork().getConnection().execute(
      `
        UPDATE outbox_messages
        SET locked_until = NOW() - INTERVAL '1 second'
        WHERE id = ?::uuid
      `,
      [message.id],
    );

    const secondRepository = new OutboxMessageRepository(
      orm.em.fork(),
    );

    const secondBatch = await secondRepository.claimPending(100);
    const secondClaim = secondBatch.find(
      (item) => item.id === message.id,
    );

    expect(secondClaim?.claimToken).toBeDefined();
    expect(secondClaim?.claimToken).not.toBe(
      firstClaim?.claimToken,
    );

    const stalePublication = await new OutboxMessageRepository(
      orm.em.fork(),
    ).markPublished(message.id, firstClaim!.claimToken!);

    expect(stalePublication).toBe(false);
  });
});
