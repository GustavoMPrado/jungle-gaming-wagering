
import 'dotenv/config';
import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';

import {
  WalletRecordSchema,
} from './infrastructure/persistence/entities/wallet-record.entity.js';

import {
  WagerTransactionRecordSchema,
} from './infrastructure/persistence/entities/wager-transaction-record.entity.js';

import {
  WalletLedgerEntryRecordSchema,
} from './infrastructure/persistence/entities/wallet-ledger-entry-record.entity.js';

import {
  OutboxMessageRecordSchema,
} from './infrastructure/persistence/entities/outbox-message-record.entity.js';

export default defineConfig({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5433),
  dbName: process.env.DB_NAME ?? 'jungle_gaming',
  user: process.env.DB_USER ?? 'jungle',
  password: process.env.DB_PASSWORD,
  entities: [
    WalletRecordSchema,
    WagerTransactionRecordSchema,
    WalletLedgerEntryRecordSchema,
    OutboxMessageRecordSchema,
  ],
  extensions: [Migrator],
  migrations: {
    path: './dist/migrations',
    pathTs: './src/migrations',
    transactional: true,
    allOrNothing: true,
  },
});
