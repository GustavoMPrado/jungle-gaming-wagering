import { Migration } from '@mikro-orm/migrations';

export class Migration202610290002 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create or replace function prevent_ledger_changes()
      returns trigger
      language plpgsql
      as $$
      begin
        raise exception 'Ledger entries are immutable'
          using errcode = '23514';
      end;
      $$;
    `);

    this.addSql(`
      create trigger trg_ledger_immutable
      before update or delete on wallet_ledger_entries
      for each row
      execute function prevent_ledger_changes();
    `);

    this.addSql(`
      create trigger trg_ledger_no_truncate
      before truncate on wallet_ledger_entries
      for each statement
      execute function prevent_ledger_changes();
    `);

    this.addSql(`
      create or replace function assert_wallet_financial_consistency(
        target_wallet_id uuid
      )
      returns void
      language plpgsql
      as $$
      declare
        wallet_balance numeric(20, 2);
        ledger_balance numeric(20, 2);
        tx record;
        expected_direction varchar(10);
        entry_count integer;
        entry_direction varchar(10);
        entry_amount numeric(20, 2);
        referenced_tx record;
      begin
        select balance
        into wallet_balance
        from wallets
        where id = target_wallet_id;

        if not found then
          return;
        end if;

        select coalesce(
          sum(
            case
              when direction = 'CREDIT' then amount
              else -amount
            end
          ),
          0
        )
        into ledger_balance
        from wallet_ledger_entries
        where wallet_id = target_wallet_id;

        if wallet_balance <> ledger_balance then
          raise exception
            'Wallet balance differs from ledger balance'
            using errcode = '23514';
        end if;

        for tx in
          select *
          from wager_transactions
          where wallet_id = target_wallet_id
        loop
          select count(*), max(direction), max(amount)
          into entry_count, entry_direction, entry_amount
          from wallet_ledger_entries
          where transaction_id = tx.id;

          if tx.status <> 'PROCESSED' or tx.kind = 'LOSS' then
            if entry_count <> 0 then
              raise exception
                'Transaction must not have a ledger entry'
                using errcode = '23514';
            end if;

            continue;
          end if;

          if entry_count <> 1 then
            raise exception
              'Processed balance transaction requires one ledger entry'
              using errcode = '23514';
          end if;

          expected_direction := case tx.kind
            when 'BET' then 'DEBIT'
            when 'OPENING' then 'CREDIT'
            when 'WIN' then 'CREDIT'
            when 'REFUND' then 'CREDIT'
            else null
          end;

          if tx.kind in ('REFUND', 'ROLLBACK') then
            if tx.reference_transaction_id is null then
              raise exception
                'Processed reversal requires a resolved reference'
                using errcode = '23514';
            end if;

            select *
            into referenced_tx
            from wager_transactions
            where id = tx.reference_transaction_id;

            if not found
              or referenced_tx.status <> 'PROCESSED'
              or referenced_tx.provider_id <> tx.provider_id
              or referenced_tx.player_id <> tx.player_id
              or referenced_tx.wallet_id <> tx.wallet_id
              or referenced_tx.currency <> tx.currency
              or referenced_tx.round_id <> tx.round_id
              or referenced_tx.amount <> tx.amount
              or referenced_tx.external_transaction_id
                <> tx.reference_external_transaction_id
            then
              raise exception
                'Invalid processed reversal reference'
                using errcode = '23514';
            end if;

            if tx.kind = 'REFUND' then
              if referenced_tx.kind <> 'BET' then
                raise exception
                  'REFUND must reference a processed BET'
                  using errcode = '23514';
              end if;
            else
              expected_direction := case referenced_tx.kind
                when 'BET' then 'CREDIT'
                when 'WIN' then 'DEBIT'
                when 'REFUND' then 'DEBIT'
                else null
              end;
            end if;
          end if;

          if expected_direction is null
            or entry_direction <> expected_direction
            or entry_amount <> tx.amount
          then
            raise exception
              'Ledger entry does not match transaction'
              using errcode = '23514';
          end if;
        end loop;
      end;
      $$;
    `);

    this.addSql(`
      create or replace function check_wallet_financial_consistency()
      returns trigger
      language plpgsql
      as $$
      begin
        perform assert_wallet_financial_consistency(new.id);
        return null;
      end;
      $$;
    `);

    this.addSql(`
      create constraint trigger trg_wallet_financial_consistency
      after insert or update on wallets
      deferrable initially deferred
      for each row
      execute function check_wallet_financial_consistency();
    `);

    this.addSql(`
      create or replace function check_transaction_financial_consistency()
      returns trigger
      language plpgsql
      as $$
      begin
        perform assert_wallet_financial_consistency(new.wallet_id);

        if tg_op = 'UPDATE'
          and old.wallet_id <> new.wallet_id
        then
          perform assert_wallet_financial_consistency(old.wallet_id);
        end if;

        return null;
      end;
      $$;
    `);

    this.addSql(`
      create constraint trigger trg_transaction_financial_consistency
      after insert or update on wager_transactions
      deferrable initially deferred
      for each row
      execute function check_transaction_financial_consistency();
    `);

    this.addSql(`
      create or replace function check_ledger_financial_consistency()
      returns trigger
      language plpgsql
      as $$
      begin
        perform assert_wallet_financial_consistency(new.wallet_id);
        return null;
      end;
      $$;
    `);

    this.addSql(`
      create constraint trigger trg_ledger_financial_consistency
      after insert on wallet_ledger_entries
      deferrable initially deferred
      for each row
      execute function check_ledger_financial_consistency();
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      drop trigger if exists
        trg_ledger_financial_consistency
      on wallet_ledger_entries;
    `);

    this.addSql(`
      drop trigger if exists
        trg_transaction_financial_consistency
      on wager_transactions;
    `);

    this.addSql(`
      drop trigger if exists
        trg_wallet_financial_consistency
      on wallets;
    `);

    this.addSql(`
      drop trigger if exists
        trg_ledger_no_truncate
      on wallet_ledger_entries;
    `);

    this.addSql(`
      drop trigger if exists
        trg_ledger_immutable
      on wallet_ledger_entries;
    `);

    this.addSql(`
      drop function if exists
        check_ledger_financial_consistency();
    `);

    this.addSql(`
      drop function if exists
        check_transaction_financial_consistency();
    `);

    this.addSql(`
      drop function if exists
        check_wallet_financial_consistency();
    `);

    this.addSql(`
      drop function if exists
        assert_wallet_financial_consistency(uuid);
    `);

    this.addSql(`
      drop function if exists
        prevent_ledger_changes();
    `);
  }
}
