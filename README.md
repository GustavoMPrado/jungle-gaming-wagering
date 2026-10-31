# Distributed Wagering Processor

Technical challenge developed for Jungle Gaming.

A distributed financial transaction processor built with NestJS, TypeScript, Bun, PostgreSQL, MikroORM, and AWS SQS (emulated by MiniStack).

The project focuses on financial correctness, concurrency control, persistent idempotency, auditability, and recovery from distributed failures.

## Technology Stack

- Bun 1.x
- TypeScript (strict mode)
- NestJS 12
- PostgreSQL 16
- MikroORM 7
- AWS SQS (MiniStack)
- Docker Compose
- decimal.js
- Bun Test

## Features

### Financial Operations

| Operation | Behavior |
|---|---|
| BET | Debits the wallet |
| WIN | Credits the wallet |
| LOSS | Records an outcome without changing the balance |
| REFUND | Reverses a processed BET |
| ROLLBACK | Reverses a processed BET, WIN, or REFUND |

REFUND and ROLLBACK require a valid reference transaction. References must match the provider, player, wallet, currency, round, and amount.

The application supports out-of-order references through the `PENDING_REFERENCE` status and a background retry worker.

### Financial Guarantees

- Exact decimal arithmetic using `decimal.js`
- Monetary storage using PostgreSQL `NUMERIC(20, 2)`
- Non-negative wallet balances
- PostgreSQL row-level locking
- Persistent idempotency
- Immutable ledger entries
- Financial consistency checks at transaction commit
- Atomic persistence of financial changes and outgoing events

### Asynchronous Processing

- SQS FIFO consumer
- Persistent inbox
- Transactional outbox
- Exponential retry handling
- Dead-letter queue (DLQ)
- Background event publishing
- Graceful consumer shutdown

### Observability

- Structured JSON logs
- Correlation identifiers
- Transaction and duplicate counters
- Retry and lock conflict metrics
- Outbox publication metrics
- Processing duration and outbox lag metrics
- DLQ monitoring
- Health endpoints

## Project Structure

```text
src/
├── application/
│   ├── use-cases/
│   │   ├── wagering/
│   │   └── wallet/
│   ├── utils/
│   └── workers/
├── domain/
│   ├── entities/
│   ├── events/
│   └── value-objects/
├── infrastructure/
│   ├── auth/
│   ├── messaging/
│   ├── observability/
│   └── persistence/
│       ├── entities/
│       └── repository/
├── interfaces/
│   └── http/
├── migrations/
├── app.module.ts
├── main.ts
└── mikro-orm.config.ts

test/
├── integration/
│   ├── inbox/
│   ├── messaging/
│   ├── outbox/
│   ├── pending-reference/
│   ├── wagering/
│   └── wallet/
└── unit/
```

Some unit tests remain colocated with their implementation files under `src/`. Additional unit tests and integration tests are organized under `test/`.

## Requirements

- Bun 1.x
- Node.js
- Docker and Docker Compose
- Git

PostgreSQL and MiniStack are started using Docker Compose.

## Local Setup

### 1. Clone the repository

```bash
git clone <repository-url>
cd jungle-gaming-wagering
```

### 2. Install dependencies

```bash
bun install
```

### 3. Configure environment variables

Create a `.env` file in the project root.

Example local configuration:

```dotenv
DB_HOST=localhost
DB_PORT=5433
DB_NAME=jungle_gaming
DB_USER=jungle
DB_PASSWORD=your_local_password

AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
SQS_ENDPOINT=http://localhost:4566

SQS_QUEUE_URL=http://localhost:4566/000000000000/wager-transactions.fifo
SQS_EVENTS_QUEUE_URL=http://localhost:4566/000000000000/wager-events.fifo
SQS_DLQ_URL=http://localhost:4566/000000000000/wager-transactions-dlq.fifo

PORT=3000
```

The database connection variables must match `src/mikro-orm.config.ts`.

Do not commit passwords or `.env` files.

### 4. Start infrastructure

```bash
docker compose up -d
```

Check the containers:

```bash
docker compose ps
```

The Compose file provides:

- PostgreSQL 16, available on `localhost:5433`
- MiniStack, available on `localhost:4566`

Application instances are started separately.

### 5. Apply database migrations

```bash
bunx mikro-orm migration:up
```

List applied migrations:

```bash
bunx mikro-orm migration:list
```

The project includes:

- `Migration202610290001`
- `Migration202610290002`

Migration rollback is supported:

```bash
bunx mikro-orm migration:down
```

Use rollback only in an isolated test environment unless an appropriate data recovery plan exists.

### 6. Configure SQS queues

Create the dead-letter queue:

```powershell
docker exec jungle-gaming-ministack awslocal sqs create-queue --queue-name wager-transactions-dlq.fifo --attributes FifoQueue=true
```

Create the wagering queue:

```powershell
docker exec jungle-gaming-ministack awslocal sqs create-queue --queue-name wager-transactions.fifo --attributes FifoQueue=true
```

Create the outgoing event queue:

```powershell
docker exec jungle-gaming-ministack awslocal sqs create-queue --queue-name wager-events.fifo --attributes FifoQueue=true
```

Configure the dead-letter policy:

```powershell
$redrive = '{"deadLetterTargetArn":"arn:aws:sqs:us-east-1:000000000000:wager-transactions-dlq.fifo","maxReceiveCount":5}'

docker exec jungle-gaming-ministack awslocal sqs set-queue-attributes --queue-url http://localhost:4566/000000000000/wager-transactions.fifo --attributes "RedrivePolicy=$redrive"
```

Check the queues:

```powershell
docker exec jungle-gaming-ministack awslocal sqs list-queues
```

Check the redrive configuration:

```powershell
docker exec jungle-gaming-ministack awslocal sqs get-queue-attributes --queue-url http://localhost:4566/000000000000/wager-transactions.fifo --attribute-names RedrivePolicy
```

### 7. Build

```bash
bun run build
```

### 8. Run

```bash
node --enable-source-maps dist/main.js
```

The HTTP application uses port `3000` by default.

## HTTP API

### Wallet Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/wallets` | Create a wallet |
| GET | `/wallets/:walletId` | Retrieve wallet information |
| GET | `/wallets/:walletId/ledger` | Retrieve paginated ledger entries |
| POST | `/wallets/:walletId/reconciliation` | Check financial consistency |

Example wallet creation:

```json
{
  "playerId": "player-example",
  "initialBalance": {
    "amount": "100.00",
    "currency": "BRL"
  }
}
```

A positive initial balance creates an internal OPENING transaction and its corresponding ledger entry.

Ledger pagination accepts `cursor` and `limit` query parameters.

The default limit is 50, with a maximum of 100.

### Wagering Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/wagering/transactions` | Process a wagering operation |
| GET | `/wagering/transactions/:transactionId` | Find by internal transaction ID |
| GET | `/providers/:providerId/wagering/transactions/:externalTransactionId` | Find by provider transaction ID |

Example BET request:

```http
POST /wagering/transactions
Idempotency-Key: provider-a:transaction-123
Content-Type: application/json
```

```json
{
  "providerId": "provider-a",
  "externalTransactionId": "transaction-123",
  "playerId": "player-example",
  "walletId": "<existing-wallet-uuid>",
  "roundId": "round-123",
  "gameId": "game-example",
  "kind": "BET",
  "money": {
    "amount": "25.00",
    "currency": "BRL"
  }
}
```

Example successful response:

```json
{
  "transactionId": "<transaction-uuid>",
  "status": "PROCESSED",
  "balance": {
    "amount": "75.00",
    "currency": "BRL"
  },
  "idempotentReplay": false
}
```

Monetary input accepts decimal strings with up to two fractional digits. Financial values are normalized to two decimal places.

### HTTP Status Codes

| Situation | Status |
|---|---|
| Wallet created | `201 Created` |
| Transaction processed | `200 OK` |
| Pending reference | `202 Accepted` |
| Invalid request | `400 Bad Request` |
| Idempotency conflict | `409 Conflict` |
| Resource not found | `404 Not Found` |
| Business rejection | `422 Unprocessable Entity` |
| Processing infrastructure failure | `503 Service Unavailable` |

### Reconciliation

```http
POST /wallets/:walletId/reconciliation
```

Reconciliation compares the stored balance with the balance reconstructed from the wallet ledger.

It reports inconsistencies without modifying historical financial entries.

## Health and Metrics

### Liveness

```http
GET /health/live
```

### Readiness

```http
GET /health/ready
```

Readiness checks PostgreSQL and SQS connectivity.

### Metrics

```http
GET /metrics
```

The metrics response includes:

- Instance identifier
- Timestamp
- Counters
- Duration measurements
- DLQ information

Metrics are instance-local, maintained in memory, and reset when a process restarts.

## SQS Consumer

The input queue is:

```text
wager-transactions.fifo
```

Messages use the `WagerTransactionRequested` envelope.

Example:

```json
{
  "messageId": "message-123",
  "type": "WagerTransactionRequested",
  "occurredAt": "2026-10-31T12:00:00.000Z",
  "data": {
    "providerId": "provider-a",
    "externalTransactionId": "transaction-123",
    "idempotencyKey": "provider-a:transaction-123",
    "playerId": "player-example",
    "walletId": "<existing-wallet-uuid>",
    "roundId": "round-123",
    "gameId": "game-example",
    "kind": "WIN",
    "money": {
      "amount": "25.00",
      "currency": "BRL"
    }
  }
}
```

The consumer:

1. Receives and validates the message.
2. Computes the canonical business payload hash.
3. Claims the message through the persistent inbox.
4. Executes the financial use case inside a PostgreSQL transaction.
5. Marks the inbox record as processed.
6. Commits the transaction.
7. Acknowledges the SQS message.

An already processed message is acknowledged without applying another financial operation.

The consumer requests one message per polling operation, uses a 10-second long polling window, and sets a 60-second initial visibility timeout.

Transient failures use exponential retry delays starting at 5 seconds, capped at 60 seconds.

Malformed and permanently invalid messages can reach the DLQ through SQS redrive after repeated delivery.

## Transactional Outbox

Integration events are stored in PostgreSQL within the same transaction as the financial changes.

The background publisher sends pending events to:

```text
wager-events.fifo
```

Supported events:

- `WagerTransactionProcessed`
- `WagerTransactionRejected`
- `WagerTransactionPendingReference`
- `WalletBalanceChanged`

The publisher uses:

- Persistent message claims
- SQS FIFO message grouping
- Stable event identifiers for deduplication
- Retry scheduling
- Recovery of abandoned claims

Publishing retries use exponential backoff, capped at 300 seconds.

Publishing is at-least-once. Consumers of outgoing events must be idempotent.

## Automated Tests

Run the configured test suite:

```bash
bun run test
```

Run the SQS consumer integration tests:

```bash
bun test --timeout 360000 test/integration/messaging/sqs-wager.consumer.integration.test.ts
```

Test failure between commit and acknowledgment:

```bash
bun test test/integration/messaging/sqs-commit-before-ack.integration.test.ts
```

Test graceful consumer shutdown:

```bash
bun test test/integration/messaging/sqs-graceful-shutdown.integration.test.ts
```

Integration tests require PostgreSQL and MiniStack.

Other automated tests cover:

- Money and domain rules
- Wallet creation
- Transaction processing
- Database atomicity
- Idempotency
- Concurrency
- Ledger queries
- Reconciliation
- Inbox and outbox persistence
- Pending references
- SQS retries and DLQ behavior

The commit-before-ACK and graceful shutdown tests use controlled failure simulations.

They do not constitute separate validation of a real Linux process crash during active processing.

## Concurrency

The application uses PostgreSQL row-level locking on the wallet.

For an initial balance of `100.00 BRL`, two concurrent BET requests of `80.00 BRL` must not both succeed.

The expected result is:

- One processed BET
- One rejected BET
- Final balance of `20.00 BRL`
- Exactly one corresponding debit ledger entry

This protects financial consistency across application instances.

## Authentication

Authentication was intentionally not implemented because it is optional and does not contribute points in the challenge evaluation.

The application registers a `ProviderAuthGuard` as a no-op extension point.

Currently, the guard allows requests without validating credentials.

A future implementation could integrate Keycloak, Zitadel, or another external Identity Provider using OIDC/OAuth 2.0.

Health endpoints should remain public.

## Architecture

Detailed technical decisions and trade-offs are documented in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Known Limitations

- Authentication and authorization are not enforced.
- Metrics are not persisted or aggregated across instances.
- Docker Compose starts infrastructure services but does not deploy three application replicas.
- Local SQS emulation is not equivalent to a production AWS deployment.
- Integration tests cover selected failure scenarios, not every possible infrastructure failure.
- Automated test files are currently distributed between `src/` and `test/`.

This implementation was developed as a technical challenge, with financial correctness and distributed processing guarantees as its main priorities.
