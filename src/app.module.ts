import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { MikroORM } from '@mikro-orm/postgresql';
import { SQSClient } from '@aws-sdk/client-sqs';

import mikroOrmConfig from './mikro-orm.config.js';

import { CreateWalletUseCase } from './application/use-cases/wallet/create-wallet.use-case.js';
import { GetWalletUseCase } from './application/use-cases/wallet/get-wallet.use-case.js';
import { GetWalletLedgerUseCase } from './application/use-cases/wallet/get-wallet-ledger.use-case.js';
import { ReconcileWalletUseCase } from './application/use-cases/wallet/reconcile-wallet.use-case.js';
import { GetWagerTransactionUseCase } from './application/use-cases/wagering/get-wager-transaction.use-case.js';
import { ProcessWagerTransactionUseCase } from './application/use-cases/wagering/process-wager-transaction.use-case.js';

import { PendingReferenceWorker } from './application/workers/pending-reference.worker.js';
import { PendingReferenceScheduler } from './application/workers/pending-reference.scheduler.js';

import { SqsWagerConsumer } from './infrastructure/messaging/sqs-wager.consumer.js';
import { SqsOutboxPublisher } from './infrastructure/messaging/sqs-outbox.publisher.js';

import { WalletController } from './interfaces/http/wallet.controller.js';
import { WagerController } from './interfaces/http/wager.controller.js';
import { WagerQueryController } from './interfaces/http/wager-query.controller.js';

import { HealthController } from './interfaces/http/health.controller.js';

@Module({
  imports: [
    MikroOrmModule.forRoot(mikroOrmConfig),
  ],
  controllers: [
    WalletController,
    WagerController,
    WagerQueryController,
    HealthController,
  ],
  providers: [
    {
      provide: CreateWalletUseCase,
      useFactory: (orm: MikroORM) => new CreateWalletUseCase(orm.em),
      inject: [MikroORM],
    },
    {
      provide: GetWalletUseCase,
      useFactory: (orm: MikroORM) => new GetWalletUseCase(orm.em),
      inject: [MikroORM],
    },
    {
      provide: GetWalletLedgerUseCase,
      useFactory: (orm: MikroORM) => new GetWalletLedgerUseCase(orm.em),
      inject: [MikroORM],
    },
    {
      provide: ReconcileWalletUseCase,
      useFactory: (orm: MikroORM) => new ReconcileWalletUseCase(orm.em),
      inject: [MikroORM],
    },
    {
      provide: GetWagerTransactionUseCase,
      useFactory: (orm: MikroORM) => new GetWagerTransactionUseCase(orm.em),
      inject: [MikroORM],
    },
    {
      provide: ProcessWagerTransactionUseCase,
      useFactory: (orm: MikroORM) =>
        new ProcessWagerTransactionUseCase(orm.em),
      inject: [MikroORM],
    },
    {
      provide: PendingReferenceWorker,
      useFactory: (orm: MikroORM) =>
        new PendingReferenceWorker(orm.em),
      inject: [MikroORM],
    },
    {
      provide: PendingReferenceScheduler,
      useFactory: (worker: PendingReferenceWorker) =>
        new PendingReferenceScheduler(worker, 1000),
      inject: [PendingReferenceWorker],
    },
    {
      provide: SqsWagerConsumer,
      useFactory: (orm: MikroORM) => {
        const endpoint =
          process.env.SQS_ENDPOINT ?? 'http://localhost:4566';

        const region =
          process.env.AWS_REGION ?? 'us-east-1';

        const sqs = new SQSClient({
          region,
          endpoint,
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
          },
        });

        const queueUrl =
          process.env.SQS_QUEUE_URL ??
          'http://localhost:4566/000000000000/wager-transactions.fifo';

        return new SqsWagerConsumer(orm, sqs, queueUrl);
      },
      inject: [MikroORM],
    },
    {
      provide: SqsOutboxPublisher,
      useFactory: (orm: MikroORM) => {
        const endpoint =
          process.env.SQS_ENDPOINT ?? 'http://localhost:4566';

        const region =
          process.env.AWS_REGION ?? 'us-east-1';

        const sqs = new SQSClient({
          region,
          endpoint,
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
          },
        });

        const queueUrl =
          process.env.SQS_EVENTS_QUEUE_URL ??
          'http://localhost:4566/000000000000/wager-events.fifo';

        return new SqsOutboxPublisher(orm, sqs, queueUrl);
      },
      inject: [MikroORM],
    },
  ],
})
export class AppModule {}



