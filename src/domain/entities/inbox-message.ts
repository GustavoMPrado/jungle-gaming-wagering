export interface ReceiveInboxProps {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt?: Date;
}

export interface InboxMessageState {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
  processedAt?: Date;
}

export class InboxMessage {
  private _processedAt?: Date;

  private constructor(
    public readonly messageId: string,
    public readonly consumerName: string,
    public readonly payloadHash: string,
    public readonly receivedAt: Date,
    processedAt?: Date,
  ) {
    this._processedAt = processedAt;
  }

  public static receive(props: ReceiveInboxProps): InboxMessage {
    if (
      !props.messageId?.trim() ||
      !props.consumerName?.trim() ||
      !props.payloadHash?.trim()
    ) {
      throw new Error('Invalid inbox message identification');
    }

    const receivedAt = props.receivedAt ?? new Date();

    return new InboxMessage(
      props.messageId,
      props.consumerName,
      props.payloadHash,
      new Date(receivedAt.getTime()),
    );
  }

  public static rehydrate(state: InboxMessageState): InboxMessage {
    return new InboxMessage(
      state.messageId,
      state.consumerName,
      state.payloadHash,
      new Date(state.receivedAt.getTime()),
      state.processedAt
        ? new Date(state.processedAt.getTime())
        : undefined,
    );
  }

  public get processedAt(): Date | undefined {
    return this._processedAt
      ? new Date(this._processedAt.getTime())
      : undefined;
  }

  public isProcessed(): boolean {
    return this._processedAt !== undefined;
  }

  public markProcessed(at: Date = new Date()): void {
    if (this.isProcessed()) {
      throw new Error('Inbox message already processed');
    }

    this._processedAt = new Date(at.getTime());
  }

  public hasSamePayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }
}
