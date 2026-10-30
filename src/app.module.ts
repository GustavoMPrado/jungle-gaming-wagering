import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { MikroORM } from '@mikro-orm/postgresql';

import mikroOrmConfig from './mikro-orm.config.js';

import { CreateWalletUseCase } from './application/use-cases/wallet/create-wallet.use-case.js';
import { GetWalletUseCase } from './application/use-cases/wallet/get-wallet.use-case.js';
import { GetWalletLedgerUseCase } from './application/use-cases/wallet/get-wallet-ledger.use-case.js';
import { GetWagerTransactionUseCase } from './application/use-cases/wagering/get-wager-transaction.use-case.js';
import { ProcessWagerTransactionUseCase } from './application/use-cases/wagering/process-wager-transaction.use-case.js';

import { PendingReferenceWorker } from './application/workers/pending-reference.worker.js';
import { PendingReferenceScheduler } from './application/workers/pending-reference.scheduler.js';

import { WalletController } from './interfaces/http/wallet.controller.js';
import { WagerController } from './interfaces/http/wager.controller.js';
import { WagerQueryController } from './interfaces/http/wager-query.controller.js';

@Module({
  imports: [
    MikroOrmModule.forRoot(mikroOrmConfig),
  ],
  controllers: [
    WalletController,
    WagerController,
    WagerQueryController,
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
      provide: GetWagerTransactionUseCase,
      useFactory: (orm: MikroORM) => new GetWagerTransactionUseCase(orm.em),
      inject: [MikroORM],
    },
    {
      provide: ProcessWagerTransactionUseCase,
      useFactory: (orm: MikroORM) => new ProcessWagerTransactionUseCase(orm.em),
      inject: [MikroORM],
    },
    {
      provide: PendingReferenceWorker,
      useFactory: (orm: MikroORM) => new PendingReferenceWorker(orm.em),
      inject: [MikroORM],
    },
    {
      provide: PendingReferenceScheduler,
      useFactory: (worker: PendingReferenceWorker) =>
        new PendingReferenceScheduler(worker, 1000),
      inject: [PendingReferenceWorker],
    },
  ],
})
export class AppModule {}
