import { Migration } from '@mikro-orm/migrations';

export class Migration202610290001 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table wallets (
        id uuid primary key,
        player_id varchar(255) not null,
        currency varchar(10) not null,
        balance numeric(20, 2) not null default 0,
        version integer not null default 1,
        created_at timestamptz not null,
        updated_at timestamptz not null,

        constraint uq_wallet_player_currency
          unique (player_id, currency),

        constraint uq_wallet_id_currency
          unique (id, currency),

        constraint chk_wallet_balance
          check (balance >= 0),

        constraint chk_wallet_version
          check (version >= 1)
      );
    `);

    this.addSql(`
      create table wager_transactions (
        id uuid primary key,
        provider_id varchar(255) not null,
        external_transaction_id varchar(255) not null,
        idempotency_key varchar(255) not null,
        payload_hash varchar(255) not null,
        wallet_id uuid not null,
        player_id varchar(255) not null,
        round_id varchar(255) not null,
        game_id varchar(255) not null,
        kind varchar(20) not null,
        amount numeric(20, 2) not null,
        currency varchar(10) not null,
        status varchar(30) not null,
        reference_external_transaction_id varchar(255),
        reference_transaction_id uuid,
        failure_code varchar(255),
        result_balance numeric(20, 2),
        reference_attempts integer not null default 0,
        next_reference_attempt_at timestamptz,
        created_at timestamptz not null,
        processed_at timestamptz,

        constraint uq_transaction_idempotency
          unique (idempotency_key),

        constraint uq_transaction_external
          unique (provider_id, external_transaction_id),

        constraint uq_transaction_wallet_currency
          unique (id, wallet_id, currency),

        constraint fk_transaction_wallet
          foreign key (wallet_id, currency)
          references wallets (id, currency),

        constraint fk_transaction_reference
          foreign key (reference_transaction_id)
          references wager_transactions (id),

        constraint chk_transaction_kind
          check (
            kind in (
              'OPENING', 'BET', 'WIN',
              'LOSS', 'REFUND', 'ROLLBACK'
            )
          ),

        constraint chk_transaction_status
          check (
            status in (
              'PENDING', 'PENDING_REFERENCE',
              'PROCESSED', 'REJECTED', 'FAILED'
            )
          ),

        constraint chk_transaction_amount
          check (amount > 0),

        constraint chk_transaction_result_balance
          check (
            result_balance is null or result_balance >= 0
          ),

        constraint chk_reference_attempts
          check (
            reference_attempts between 0 and 10
          ),

        constraint chk_reversal_reference
          check (
            kind not in ('REFUND', 'ROLLBACK')
            or nullif(trim(reference_external_transaction_id), '')
              is not null
          )
      );
    `);

    this.addSql(`
      create unique index uq_processed_reversal
      on wager_transactions (reference_transaction_id, kind)
      where status = 'PROCESSED'
        and kind in ('REFUND', 'ROLLBACK')
        and reference_transaction_id is not null;
    `);

    this.addSql(`
      create index idx_transaction_reference_due
      on wager_transactions (
        status, next_reference_attempt_at
      );
    `);

    this.addSql(`
      create table wallet_ledger_entries (
        id uuid primary key,
        wallet_id uuid not null,
        transaction_id uuid not null,
        direction varchar(10) not null,
        amount numeric(20, 2) not null,
        currency varchar(10) not null,
        balance_before numeric(20, 2) not null,
        balance_after numeric(20, 2) not null,
        created_at timestamptz not null,

        constraint uq_ledger_transaction_wallet
          unique (transaction_id, wallet_id),

        constraint fk_ledger_wallet
          foreign key (wallet_id, currency)
          references wallets (id, currency),

        constraint fk_ledger_transaction
          foreign key (transaction_id, wallet_id, currency)
          references wager_transactions (
            id, wallet_id, currency
          ),

        constraint chk_ledger_direction
          check (direction in ('DEBIT', 'CREDIT')),

        constraint chk_ledger_amount
          check (amount > 0),

        constraint chk_ledger_balances
          check (
            balance_before >= 0
            and balance_after >= 0
          ),

        constraint chk_ledger_arithmetic
          check (
            (
              direction = 'CREDIT'
              and balance_after = balance_before + amount
            )
            or
            (
              direction = 'DEBIT'
              and balance_after = balance_before - amount
            )
          )
      );
    `);

    this.addSql(`
      create index idx_ledger_wallet_cursor
      on wallet_ledger_entries (
        wallet_id, created_at, id
      );
    `);

    this.addSql(`
      create table inbox_messages (
        consumer_name varchar(255) not null,
        message_id varchar(255) not null,
        payload_hash varchar(255) not null,
        received_at timestamptz not null,
        processed_at timestamptz,

        constraint pk_inbox_messages
          primary key (consumer_name, message_id)
      );
    `);

    this.addSql(`
      create table outbox_messages (
        id uuid primary key,
        aggregate_id varchar(255) not null,
        event_type varchar(255) not null,
        payload jsonb not null,
        occurred_at timestamptz not null,
        attempts integer not null default 0,
        next_attempt_at timestamptz,
        published_at timestamptz,
        claim_token uuid,
        locked_until timestamptz,

        constraint chk_outbox_attempts
          check (attempts >= 0),

        constraint chk_outbox_claim
          check (
            (claim_token is null and locked_until is null)
            or
            (claim_token is not null and locked_until is not null)
          ),

        constraint chk_outbox_published
          check (
            published_at is null
            or
            (claim_token is null and locked_until is null)
          ),

        constraint chk_outbox_payload
          check (jsonb_typeof(payload) = 'object')
      );
    `);

    this.addSql(`
      create index idx_outbox_due
      on outbox_messages (
        next_attempt_at, locked_until, occurred_at
      )
      where published_at is null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists outbox_messages;');
    this.addSql('drop table if exists inbox_messages;');
    this.addSql('drop table if exists wallet_ledger_entries;');
    this.addSql('drop table if exists wager_transactions;');
    this.addSql('drop table if exists wallets;');
  }
}
