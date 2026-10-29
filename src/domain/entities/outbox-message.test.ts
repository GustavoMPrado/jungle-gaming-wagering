
import { describe, expect, it } from 'bun:test';
import {
  OutboxMessage,
  type EnqueueOutboxMessageProps,
} from './outbox-message.js';

describe('OutboxMessage', () => {
  const initialDate = new Date('2026-10-29T15:00:00.000Z');

  function createProps(): EnqueueOutboxMessageProps {
    return {
      id: 'event-1',
      aggregateId: 'transaction-1',
      eventType: 'WagerTransactionProcessed',
      payload: {
        eventId: 'event-1',
        aggregateId: 'transaction-1',
        eventType: 'WagerTransactionProcessed',
        version: 1,
        data: {
          amount: '25.00',
          currency: 'BRL',
        },
      },
      occurredAt: initialDate,
    };
  }

  function createMessage(): OutboxMessage {
    return OutboxMessage.enqueue(createProps());
  }

  describe('enqueue', () => {
    it('should create a pending message', () => {
      const message = createMessage();

      expect(message.id).toBe('event-1');
      expect(message.aggregateId).toBe('transaction-1');
      expect(message.eventType).toBe('WagerTransactionProcessed');
      expect(message.attempts).toBe(0);
      expect(message.isPending()).toBe(true);
      expect(message.isDue(initialDate)).toBe(true);
      expect(message.publishedAt).toBeUndefined();
    });

    it('should reject missing identification', () => {
      for (const field of [
        'id',
        'aggregateId',
        'eventType',
      ] as const) {
        expect(() =>
          OutboxMessage.enqueue({
            ...createProps(),
            [field]: '',
          }),
        ).toThrow('Invalid outbox identification');
      }
    });

    it('should reject an invalid payload', () => {
      expect(() =>
        OutboxMessage.enqueue({
          ...createProps(),
          payload: null as unknown as Record<string, unknown>,
        }),
      ).toThrow('Invalid outbox payload');
    });

    it('should reject invalid dates', () => {
      expect(() =>
        OutboxMessage.enqueue({
          ...createProps(),
          occurredAt: new Date('invalid'),
        }),
      ).toThrow('Invalid outbox date');
    });

    it('should protect its payload from external changes', () => {
      const props = createProps();
      const message = OutboxMessage.enqueue(props);

      const originalData = props.payload.data as {
        amount: string;
      };

      originalData.amount = '999.00';

      const storedData = message.payload.data as {
        amount: string;
      };

      expect(storedData.amount).toBe('25.00');

      storedData.amount = '500.00';

      const returnedData = message.payload.data as {
        amount: string;
      };

      expect(returnedData.amount).toBe('25.00');
    });

    it('should protect the occurrence date', () => {
      const occurredAt = new Date(initialDate);

      const message = OutboxMessage.enqueue({
        ...createProps(),
        occurredAt,
      });

      occurredAt.setFullYear(2030);
      message.occurredAt.setFullYear(2040);

      expect(message.occurredAt.getFullYear()).toBe(2026);
    });
  });

  describe('claim', () => {
    it('should reserve a message for 30 seconds', () => {
      const message = createMessage();

      message.claim('token-1', initialDate);

      expect(message.claimToken).toBe('token-1');
      expect(message.lockedUntil?.toISOString()).toBe(
        '2026-10-29T15:00:30.000Z',
      );
      expect(message.isDue(initialDate)).toBe(false);
    });

    it('should reject another claim during an active lease', () => {
      const message = createMessage();

      message.claim('token-1', initialDate);

      expect(() =>
        message.claim(
          'token-2',
          new Date('2026-10-29T15:00:10.000Z'),
        ),
      ).toThrow('Outbox message is not available');
    });

    it('should allow recovery after lease expiration', () => {
      const message = createMessage();

      message.claim('token-1', initialDate);

      const afterExpiration = new Date(
        '2026-10-29T15:00:31.000Z',
      );

      expect(message.isDue(afterExpiration)).toBe(true);

      message.claim('token-2', afterExpiration);

      expect(message.claimToken).toBe('token-2');
      expect(message.lockedUntil?.toISOString()).toBe(
        '2026-10-29T15:01:01.000Z',
      );
    });

    it('should reject an empty claim token', () => {
      const message = createMessage();

      expect(() =>
        message.claim('', initialDate),
      ).toThrow('Outbox claim token is required');
    });
  });

  describe('markPublished', () => {
    it('should mark a claimed message as published', () => {
      const message = createMessage();
      const publishedAt = new Date(
        '2026-10-29T15:00:05.000Z',
      );

      message.claim('token-1', initialDate);
      message.markPublished('token-1', publishedAt);

      expect(message.isPending()).toBe(false);
      expect(message.publishedAt).toEqual(publishedAt);
      expect(message.claimToken).toBeUndefined();
      expect(message.lockedUntil).toBeUndefined();
      expect(message.isDue(publishedAt)).toBe(false);
    });

    it('should prevent publication with the wrong token', () => {
      const message = createMessage();

      message.claim('token-1', initialDate);

      expect(() =>
        message.markPublished('token-2'),
      ).toThrow('Outbox claim token mismatch');

      expect(message.isPending()).toBe(true);
    });

    it('should prevent an expired worker from updating a new claim', () => {
      const message = createMessage();

      message.claim('token-1', initialDate);

      message.claim(
        'token-2',
        new Date('2026-10-29T15:00:31.000Z'),
      );

      expect(() =>
        message.markPublished('token-1'),
      ).toThrow('Outbox claim token mismatch');

      expect(message.claimToken).toBe('token-2');
      expect(message.isPending()).toBe(true);
    });

    it('should prevent publishing twice', () => {
      const message = createMessage();

      message.claim('token-1', initialDate);
      message.markPublished('token-1');

      expect(() =>
        message.markPublished('token-1'),
      ).toThrow('Outbox claim token mismatch');
    });
  });

  describe('scheduleRetry', () => {
    it('should record a failed publication attempt', () => {
      const message = createMessage();

      message.claim('token-1', initialDate);

      const retryDate = new Date(
        '2026-10-29T15:00:10.000Z',
      );

      message.scheduleRetry('token-1', retryDate);

      expect(message.attempts).toBe(1);
      expect(message.nextAttemptAt).toEqual(retryDate);
      expect(message.claimToken).toBeUndefined();
      expect(message.lockedUntil).toBeUndefined();
      expect(message.isPending()).toBe(true);
    });

    it('should wait until the next scheduled attempt', () => {
      const message = createMessage();

      message.claim('token-1', initialDate);

      message.scheduleRetry(
        'token-1',
        new Date('2026-10-29T15:00:10.000Z'),
      );

      expect(
        message.isDue(
          new Date('2026-10-29T15:00:09.000Z'),
        ),
      ).toBe(false);

      expect(
        message.isDue(
          new Date('2026-10-29T15:00:10.000Z'),
        ),
      ).toBe(true);
    });

    it('should preserve the event identifier across retries', () => {
      const message = createMessage();

      message.claim('token-1', initialDate);

      message.scheduleRetry(
        'token-1',
        new Date('2026-10-29T15:00:10.000Z'),
      );

      message.claim(
        'token-2',
        new Date('2026-10-29T15:00:10.000Z'),
      );

      expect(message.id).toBe('event-1');
      expect(message.attempts).toBe(1);

      expect(message.payload.eventId).toBe('event-1');
    });

    it('should prevent retry scheduling with an invalid token', () => {
      const message = createMessage();

      message.claim('token-1', initialDate);

      expect(() =>
        message.scheduleRetry(
          'token-2',
          new Date('2026-10-29T15:00:10.000Z'),
        ),
      ).toThrow('Outbox claim token mismatch');

      expect(message.attempts).toBe(0);
    });
  });

  describe('rehydrate', () => {
    it('should restore an unpublished message', () => {
      const message = OutboxMessage.rehydrate({
        ...createProps(),
        occurredAt: initialDate,
        attempts: 2,
        nextAttemptAt: new Date(
          '2026-10-29T15:01:00.000Z',
        ),
      });

      expect(message.isPending()).toBe(true);
      expect(message.attempts).toBe(2);
      expect(message.nextAttemptAt?.toISOString()).toBe(
        '2026-10-29T15:01:00.000Z',
      );
    });

    it('should restore an active claim', () => {
      const message = OutboxMessage.rehydrate({
        ...createProps(),
        occurredAt: initialDate,
        attempts: 0,
        claimToken: 'token-1',
        lockedUntil: new Date(
          '2026-10-29T15:00:30.000Z',
        ),
      });

      expect(message.claimToken).toBe('token-1');
      expect(message.isDue(initialDate)).toBe(false);
    });

    it('should restore a published message', () => {
      const message = OutboxMessage.rehydrate({
        ...createProps(),
        occurredAt: initialDate,
        attempts: 1,
        publishedAt: new Date(
          '2026-10-29T15:01:00.000Z',
        ),
      });

      expect(message.isPending()).toBe(false);
      expect(message.isDue(new Date())).toBe(false);
    });

    it('should reject invalid attempt counts', () => {
      for (const attempts of [-1, 1.5]) {
        expect(() =>
          OutboxMessage.rehydrate({
            ...createProps(),
            occurredAt: initialDate,
            attempts,
          }),
        ).toThrow('Invalid outbox attempts');
      }
    });

    it('should reject incomplete claim state', () => {
      expect(() =>
        OutboxMessage.rehydrate({
          ...createProps(),
          occurredAt: initialDate,
          attempts: 0,
          claimToken: 'token-1',
        }),
      ).toThrow('Invalid outbox claim');
    });

    it('should reject a published message with an active claim', () => {
      expect(() =>
        OutboxMessage.rehydrate({
          ...createProps(),
          occurredAt: initialDate,
          attempts: 0,
          publishedAt: new Date(initialDate),
          claimToken: 'token-1',
          lockedUntil: new Date(
            '2026-10-29T15:00:30.000Z',
          ),
        }),
      ).toThrow('Published message cannot be claimed');
    });
  });
});
