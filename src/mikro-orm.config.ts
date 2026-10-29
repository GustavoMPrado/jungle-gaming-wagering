import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';

export default defineConfig({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5433),
  dbName: process.env.DB_NAME ?? 'jungle_gaming',
  user: process.env.DB_USER ?? 'jungle',
  password: process.env.DB_PASSWORD,
  entities: ['./dist/**/*.entity.js'],
  entitiesTs: ['./src/**/*.entity.ts'],
  extensions: [Migrator],
  migrations: {
    path: './dist/migrations',
    pathTs: './src/migrations',
    transactional: true,
    allOrNothing: true,
  },
  discovery: {
    warnWhenNoEntities: false,
  },
});