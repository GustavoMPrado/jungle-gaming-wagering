import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MikroORM } from '@mikro-orm/postgresql';
import {
  GetQueueAttributesCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

@Controller('health')
export class HealthController {
  public constructor(
    @Inject(MikroORM)
    private readonly orm: MikroORM,
  ) {}

  @Get('live')
  @HttpCode(HttpStatus.OK)
  public live() {
    return {
      status: 'ok',
    };
  }

  @Get('ready')
  public async ready() {
    const checks = {
      postgres: false,
      sqs: false,
    };

    try {
      await this.orm.em.fork().getConnection().execute('SELECT 1');
      checks.postgres = true;
    } catch {
      checks.postgres = false;
    }

    const sqs = new SQSClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
      endpoint: process.env.SQS_ENDPOINT ?? 'http://localhost:4566',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
      },
      maxAttempts: 1,
    });

    try {
      await sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl:
            process.env.SQS_QUEUE_URL ??
            'http://localhost:4566/000000000000/wager-transactions.fifo',
          AttributeNames: ['QueueArn'],
        }),
      );

      checks.sqs = true;
    } catch {
      checks.sqs = false;
    } finally {
      sqs.destroy();
    }

    if (!checks.postgres || !checks.sqs) {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        checks,
      });
    }

    return {
      status: 'ok',
      checks,
    };
  }
}
