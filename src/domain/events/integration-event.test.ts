
import { describe, expect, it } from 'bun:test';
import {
  IntegrationEvent,
  type IntegrationEventProps,
} from './integration-event.js';

interface TestEventData {
  transactionId: string;
  nested: {
    amount: string;
  };
}

class TestEvent extends IntegrationEvent<TestEventData> {
  public constructor(props: IntegrationEventProps<TestEventData>) {
    super(props, 'TestEvent', 1);
  }
}

function createProps(): IntegrationEventProps<TestEventData> {
  return {
    eventId: 'event-1',
    aggregateId: 'transaction-1',
    correlationId: 'correlation-1',
    causationId: 'message-1',
    occurredAt: new Date('2026-10-29T15:00:00.000Z'),
    data: {
      transactionId: 'transaction-1',
      nested: {
        amount: '25.00',
      },
    },
  };
}

describe('IntegrationEvent', () => {
  it('should create an event with its envelope fields', () => {
    const event = new TestEvent(createProps());

    expect(event.eventId).toBe('event-1');
    expect(event.aggregateId).toBe('transaction-1');
    expect(event.correlationId).toBe('correlation-1');
    expect(event.causationId).toBe('message-1');
    expect(event.eventType).toBe('TestEvent');
    expect(event.version).toBe(1);
  });

  it('should serialize the event to JSON', () => {
    const event = new TestEvent(createProps());

    expect(event.toJSON()).toEqual({
      eventId: 'event-1',
      aggregateId: 'transaction-1',
      correlationId: 'correlation-1',
      causationId: 'message-1',
      occurredAt: '2026-10-29T15:00:00.000Z',
      eventType: 'TestEvent',
      version: 1,
      data: {
        transactionId: 'transaction-1',
        nested: {
          amount: '25.00',
        },
      },
    });
  });

  it('should omit causationId when not supplied', () => {
    const event = new TestEvent({
      ...createProps(),
      causationId: undefined,
    });

    expect(event.toJSON()).not.toHaveProperty('causationId');
  });

  it('should reject missing event identification', () => {
    for (const field of [
      'eventId',
      'aggregateId',
      'correlationId',
    ] as const) {
      expect(() =>
        new TestEvent({
          ...createProps(),
          [field]: '',
        }),
      ).toThrow('Invalid event identification');
    }
  });

  it('should reject an empty causation ID', () => {
    expect(() =>
      new TestEvent({
        ...createProps(),
        causationId: ' ',
      }),
    ).toThrow('Invalid causation ID');
  });

  it('should reject an invalid date', () => {
    expect(() =>
      new TestEvent({
        ...createProps(),
        occurredAt: new Date('invalid'),
      }),
    ).toThrow('Invalid event date');
  });

  it('should reject invalid event data', () => {
    expect(() =>
      new TestEvent({
        ...createProps(),
        data: null as unknown as TestEventData,
      }),
    ).toThrow('Invalid event data');
  });

  it('should protect its data from external changes', () => {
    const props = createProps();
    const event = new TestEvent(props);

    props.data.nested.amount = '500.00';

    expect(event.data.nested.amount).toBe('25.00');

    const returnedData = event.data;
    returnedData.nested.amount = '999.00';

    expect(event.data.nested.amount).toBe('25.00');
  });

  it('should protect the occurrence date', () => {
    const props = createProps();
    const event = new TestEvent(props);

    props.occurredAt?.setFullYear(2030);
    event.occurredAt.setFullYear(2040);

    expect(event.occurredAt.getFullYear()).toBe(2026);
  });

  it('should produce equivalent JSON on repeated calls', () => {
    const event = new TestEvent(createProps());

    const first = event.toJSON();
    first.data.nested.amount = '999.00';

    expect(event.toJSON().data.nested.amount).toBe('25.00');
  });
});
