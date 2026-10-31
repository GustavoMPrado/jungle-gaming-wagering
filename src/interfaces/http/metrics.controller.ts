import {
  Controller,
  Get,
  Inject,
} from '@nestjs/common';
import {
  GetQueueAttributesCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

import {
  MetricsService,
} from '../../infrastructure/observability/metrics.service.js';

@Controller('metrics')
export class MetricsController {
  public constructor(
    private readonly metrics: MetricsService,
    @Inject('METRICS_SQS_CLIENT')
    private readonly sqs: SQSClient,
  ) {}

  @Get()
  public async getMetrics() {
    const snapshot = this.metrics.snapshot();
    const dlq = await this.getDlqMetrics();

    return {
      instanceId: process.pid,
      timestamp: new Date().toISOString(),
      ...snapshot,
      dlq,
    };
  }

  private async getDlqMetrics(): Promise<{
    configured: boolean;
    approximateMessages: number | null;
    approximateInFlight: number | null;
    error?: string;
  }> {
    const queueUrl = process.env.SQS_DLQ_URL;

    if (!queueUrl) {
      return {
        configured: false,
        approximateMessages: null,
        approximateInFlight: null,
        error: 'SQS_DLQ_URL is not configured',
      };
    }

    try {
      const result = await this.sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: queueUrl,
          AttributeNames: [
            'ApproximateNumberOfMessages',
            'ApproximateNumberOfMessagesNotVisible',
          ],
        }),
      );

      const attributes = result.Attributes ?? {};

      return {
        configured: true,
        approximateMessages: this.parseCount(
          attributes.ApproximateNumberOfMessages,
        ),
        approximateInFlight: this.parseCount(
          attributes.ApproximateNumberOfMessagesNotVisible,
        ),
      };
    } catch (error) {
      return {
        configured: true,
        approximateMessages: null,
        approximateInFlight: null,
        error: error instanceof Error
          ? error.message
          : 'Unable to read DLQ attributes',
      };
    }
  }

  private parseCount(value: string | undefined): number | null {
    if (value === undefined) {
      return null;
    }

    const count = Number(value);

    return Number.isSafeInteger(count) && count >= 0
      ? count
      : null;
  }
}
