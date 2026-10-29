
import { describe, expect, it } from 'bun:test';
import {
  InboxMessage,
  type ReceiveInboxProps,
} from './inbox-message.js';

describe('InboxMessage', () => {
  function createProps(): ReceiveInboxProps {
    return {
      messageId: 'message-1',
      consumerName: 'wager-consumer',
      payloadHash: 'hash-123',
    };
  }

  describe('receive', () => {
    it('should create an unprocessed inbox message', () => {
      const message = InboxMessage.receive(createProps());

      expect(message.messageId).toBe('message-1');
      expect(message.consumerName).toBe('wager-consumer');
      expect(message.payloadHash).toBe('hash-123');
      expect(message.isProcessed()).toBe(false);
      expect(message.processedAt).toBeUndefined();
    });

    it.each(['messageId', 'consumerName', 'payloadHash'] as const)(
      'should reject an empty %s',
      (field) => {
        expect(() =>
          InboxMessage.receive({
            ...createProps(),
            [field]: ' ',
          }),
        ).toThrow('Invalid inbox message identification');
      },
    );

    it('should preserve the received timestamp', () => {
      const receivedAt = new Date('2026-10-29T15:00:00.000Z');

      const message = InboxMessage.receive({
        ...createProps(),
        receivedAt,
      });

      expect(message.receivedAt).toEqual(receivedAt);
    });
  });

  describe('processing', () => {
    it('should mark a message as processed', () => {
      const message = InboxMessage.receive(createProps());
      const processedAt = new Date('2026-10-29T15:05:00.000Z');

      message.markProcessed(processedAt);

      expect(message.isProcessed()).toBe(true);
      expect(message.processedAt).toEqual(processedAt);
    });

    it('should prevent processing twice', () => {
      const message = InboxMessage.receive(createProps());

      message.markProcessed();

      expect(() => message.markProcessed()).toThrow(
        'Inbox message already processed',
      );
    });

    it('should protect the processed timestamp from external changes', () => {
      const message = InboxMessage.receive(createProps());
      const processedAt = new Date('2026-10-29T15:05:00.000Z');

      message.markProcessed(processedAt);

      processedAt.setFullYear(2030);

      expect(message.processedAt?.getFullYear()).toBe(2026);

      const returnedDate = message.processedAt;
      returnedDate?.setFullYear(2035);

      expect(message.processedAt?.getFullYear()).toBe(2026);
    });
  });

  describe('payload', () => {
    it('should recognize an identical payload hash', () => {
      const message = InboxMessage.receive(createProps());

      expect(message.hasSamePayload('hash-123')).toBe(true);
    });

    it('should detect a different payload hash', () => {
      const message = InboxMessage.receive(createProps());

      expect(message.hasSamePayload('hash-456')).toBe(false);
    });
  });

  describe('rehydrate', () => {
    it('should reconstruct an unprocessed message', () => {
      const message = InboxMessage.rehydrate({
        ...createProps(),
        receivedAt: new Date('2026-10-29T15:00:00.000Z'),
      });

      expect(message.isProcessed()).toBe(false);
    });

    it('should reconstruct a processed message', () => {
      const message = InboxMessage.rehydrate({
        ...createProps(),
        receivedAt: new Date('2026-10-29T15:00:00.000Z'),
        processedAt: new Date('2026-10-29T15:05:00.000Z'),
      });

      expect(message.isProcessed()).toBe(true);
      expect(message.processedAt?.toISOString()).toBe(
        '2026-10-29T15:05:00.000Z',
      );
    });
  });
});
