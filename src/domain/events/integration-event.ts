
export interface MoneyProps {
  amount: string;
  currency: string;
}

export interface IntegrationEventProps<T extends object> {
  eventId: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt?: Date;
  data: T;
}

export interface IntegrationEventEnvelope<T extends object> {
  eventId: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: string;
  eventType: string;
  version: number;
  data: T;
}

export abstract class IntegrationEvent<T extends object> {
  public readonly eventId: string;
  public readonly aggregateId: string;
  public readonly correlationId: string;
  public readonly causationId?: string;
  public readonly eventType: string;
  public readonly version: number;

  private readonly _occurredAt: Date;
  private readonly _data: T;

  protected constructor(
    props: IntegrationEventProps<T>,
    eventType: string,
    version: number,
  ) {
    if (
      !props.eventId?.trim() ||
      !props.aggregateId?.trim() ||
      !props.correlationId?.trim() ||
      !eventType?.trim()
    ) {
      throw new Error('Invalid event identification');
    }

    if (
      props.causationId !== undefined &&
      !props.causationId.trim()
    ) {
      throw new Error('Invalid causation ID');
    }

    if (!Number.isInteger(version) || version < 1) {
      throw new Error('Invalid event version');
    }

    const occurredAt = props.occurredAt ?? new Date();

    if (!Number.isFinite(occurredAt.getTime())) {
      throw new Error('Invalid event date');
    }

    this.eventId = props.eventId;
    this.aggregateId = props.aggregateId;
    this.correlationId = props.correlationId;
    this.causationId = props.causationId;
    this.eventType = eventType;
    this.version = version;
    this._occurredAt = new Date(occurredAt.getTime());
    this._data = IntegrationEvent.copyData(props.data);
  }

  public get occurredAt(): Date {
    return new Date(this._occurredAt.getTime());
  }

  public get data(): T {
    return IntegrationEvent.copyData(this._data);
  }

  public toJSON(): IntegrationEventEnvelope<T> {
    return {
      eventId: this.eventId,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      ...(this.causationId
        ? { causationId: this.causationId }
        : {}),
      occurredAt: this._occurredAt.toISOString(),
      eventType: this.eventType,
      version: this.version,
      data: this.data,
    };
  }

  private static copyData<T extends object>(data: T): T {
    if (
      data === null ||
      typeof data !== 'object' ||
      Array.isArray(data)
    ) {
      throw new Error('Invalid event data');
    }

    try {
      const serialized = JSON.stringify(data);

      if (!serialized) {
        throw new Error('Invalid event data');
      }

      const copy: unknown = JSON.parse(serialized);

      if (
        copy === null ||
        typeof copy !== 'object' ||
        Array.isArray(copy)
      ) {
        throw new Error('Invalid event data');
      }

      return copy as T;
    } catch {
      throw new Error('Invalid event data');
    }
  }
}
