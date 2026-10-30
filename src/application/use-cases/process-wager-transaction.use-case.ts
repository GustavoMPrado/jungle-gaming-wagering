
import type { EntityManager } from '@mikro-orm/postgresql';
import { Money } from '../../domain/value-objects/money.js';
import { Wallet } from '../../domain/entities/wallet.js';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/entities/wager-transaction.js';
import {
  LedgerDirection,
  WalletLedgerEntry,
} from '../../domain/entities/wallet-ledger-entry.js';
import { OutboxMessage } from '../../domain/entities/outbox-message.js';
import {
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WagerTransactionPendingReference,
  WalletBalanceChanged,
} from '../../domain/events/wager-events.js';
import { WalletRepository } from '../../infrastructure/persistence/wallet.repository.js';
import { WagerTransactionRepository } from '../../infrastructure/persistence/wager-transaction.repository.js';
import { WalletLedgerEntryRepository } from '../../infrastructure/persistence/wallet-ledger-entry.repository.js';
import { OutboxMessageRepository } from '../../infrastructure/persistence/outbox-message.repository.js';
import { PendingReferenceRepository } from '../../infrastructure/persistence/pending-reference.repository.js';
import { WagerTransactionRecord } from '../../infrastructure/persistence/wager-transaction-record.entity.js';

export interface ProcessWagerTransactionInput {
  transactionId: string;
  walletId: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  amount: string;
  currency: string;
  referenceExternalTransactionId?: string;
  correlationId: string;
}

export interface ProcessWagerTransactionResult {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: string;
  failureCode?: string;
  idempotentReplay: boolean;
}

interface Repositories {
  wallets: WalletRepository;
  transactions: WagerTransactionRepository;
  ledger: WalletLedgerEntryRepository;
  outbox: OutboxMessageRepository;
}

export class ProcessWagerTransactionUseCase {
  public constructor(
    private readonly em: EntityManager,
  ) {}

  public async execute(
    input: ProcessWagerTransactionInput,
  ): Promise<ProcessWagerTransactionResult> {
    const money = Money.create(input.amount, input.currency);

    const transaction = WagerTransaction.create({
      id: input.transactionId,
      walletId: input.walletId,
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
      playerId: input.playerId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money,
      referenceExternalTransactionId:
        input.referenceExternalTransactionId,
    });

    return this.em.fork().transactional(async (em) => {
      const repos = this.repositories(em);

      const wallet = await repos.wallets.findByIdForUpdate(
        input.walletId,
      );

      if (!wallet) {
        throw new Error('Wallet not found');
      }

      if (
        wallet.playerId !== input.playerId ||
        wallet.currency !== input.currency
      ) {
        throw new Error('Wallet ownership or currency mismatch');
      }

      const previous = await em.findOne(
        WagerTransactionRecord,
        { idempotencyKey: input.idempotencyKey },
      );

      if (previous) {
        if (
          previous.payloadHash !== input.payloadHash ||
          previous.providerId !== input.providerId ||
          previous.externalTransactionId !==
            input.externalTransactionId
        ) {
          throw new Error('Idempotency conflict');
        }

        if (previous.resultBalance == null) {
          throw new Error('Stored transaction result is incomplete');
        }

        return {
          transactionId: previous.id,
          status: previous.status as WagerTransactionStatus,
          balance: previous.resultBalance,
          failureCode: previous.failureCode ?? undefined,
          idempotentReplay: true,
        };
      }

      const external = await repos.transactions.findByExternalId(
        input.providerId,
        input.externalTransactionId,
      );

      if (external) {
        throw new Error('External transaction identifier conflict');
      }

      const reference = transaction.requiresReference()
        ? await repos.transactions.findByExternalId(
            transaction.providerId,
            transaction.referenceExternalTransactionId!,
          )
        : null;

      if (
        transaction.requiresReference() &&
        this.referenceNotReady(reference)
      ) {
        transaction.markPendingReference();

        await this.savePendingReference(
          repos,
          transaction,
          wallet,
          input.correlationId,
        );

        return this.result(transaction, wallet.balance);
      }

      return this.applyTransaction(
        repos,
        wallet,
        transaction,
        reference,
        input.correlationId,
      );
    });
  }

  public async resumePendingReference(
    transactionId: string,
    now: Date = new Date(),
  ): Promise<ProcessWagerTransactionResult | null> {
    if (!Number.isFinite(now.getTime())) {
      throw new Error('Invalid reference date');
    }

    return this.em.fork().transactional(async (em) => {
      const repos = this.repositories(em);
      const pending = new PendingReferenceRepository(em);

      const candidate = await repos.transactions.findById(
        transactionId,
      );

      if (
        !candidate ||
        candidate.status !==
          WagerTransactionStatus.PendingReference
      ) {
        return null;
      }

      // Lock the wallet before locking the transaction.
      const wallet = await repos.wallets.findByIdForUpdate(
        candidate.walletId,
      );

      if (!wallet) {
        throw new Error('Wallet not found');
      }

      const locked = await pending.findByIdForUpdate(
        transactionId,
      );

      if (!locked || !pending.isDue(locked, now)) {
        return null;
      }

      const transaction = await repos.transactions.findById(
        transactionId,
      );

      if (
        !transaction ||
        transaction.status !==
          WagerTransactionStatus.PendingReference ||
        !transaction.isReferenceRetryDue(now)
      ) {
        return null;
      }

      const reference = await repos.transactions.findByExternalId(
        transaction.providerId,
        transaction.referenceExternalTransactionId!,
      );

      if (this.referenceNotReady(reference)) {
        const missing = reference === null;

        transaction.recordReferenceAttempt(now);

        if (!transaction.hasReferenceAttemptsRemaining()) {
          transaction.markRejected(
            missing
              ? 'REFERENCE_NOT_FOUND'
              : 'REFERENCE_NOT_READY',
          );

          await this.saveRejection(
            repos,
            transaction,
            wallet,
            transaction.id,
          );
        } else {
          await this.savePendingReference(
            repos,
            transaction,
            wallet,
            transaction.id,
          );
        }

        return this.result(transaction, wallet.balance);
      }

      return this.applyTransaction(
        repos,
        wallet,
        transaction,
        reference,
        transaction.id,
      );
    });
  }

  private repositories(em: EntityManager): Repositories {
    return {
      wallets: new WalletRepository(em),
      transactions: new WagerTransactionRepository(em),
      ledger: new WalletLedgerEntryRepository(em),
      outbox: new OutboxMessageRepository(em),
    };
  }

  private referenceNotReady(
    reference: WagerTransaction | null,
  ): boolean {
    return (
      reference === null ||
      reference.status === WagerTransactionStatus.Pending ||
      reference.status === WagerTransactionStatus.PendingReference
    );
  }

  private async applyTransaction(
    repos: Repositories,
    wallet: Wallet,
    transaction: WagerTransaction,
    reference: WagerTransaction | null,
    correlationId: string,
  ): Promise<ProcessWagerTransactionResult> {
    let direction: LedgerDirection | undefined;

    if (transaction.requiresReference()) {
      if (!reference) {
        throw new Error('Resolved reference is required');
      }

      const failureCode = this.validateReference(
        transaction,
        reference,
      );

      if (failureCode) {
        transaction.markRejected(failureCode);
      } else if (
        transaction.kind === WagerTransactionKind.Refund
      ) {
        direction = LedgerDirection.Credit;
      } else {
        direction = this.reverseDirection(reference.kind);
      }
    } else {
      switch (transaction.kind) {
        case WagerTransactionKind.Bet:
          direction = LedgerDirection.Debit;
          break;
        case WagerTransactionKind.Win:
          direction = LedgerDirection.Credit;
          break;
        case WagerTransactionKind.Loss:
          break;
        default:
          throw new Error('Unsupported transaction kind');
      }
    }

    if (
      !transaction.isTerminal() &&
      direction === LedgerDirection.Debit &&
      wallet.balance.isLessThan(transaction.money)
    ) {
      transaction.markRejected(
        transaction.kind === WagerTransactionKind.Bet
          ? 'INSUFFICIENT_BALANCE'
          : 'INSUFFICIENT_REVERSAL_BALANCE',
      );
    }

    if (transaction.status === WagerTransactionStatus.Rejected) {
      await this.saveRejection(
        repos,
        transaction,
        wallet,
        correlationId,
      );

      return this.result(transaction, wallet.balance);
    }

    const before = wallet.balance;

    if (direction === LedgerDirection.Debit) {
      wallet.debit(transaction.money);
    } else if (direction === LedgerDirection.Credit) {
      wallet.credit(transaction.money);
    }

    transaction.markProcessed(
      new Date(),
      reference?.id,
    );

    if (direction !== undefined) {
      await repos.wallets.save(wallet);
    }

    await repos.transactions.save(transaction, wallet.balance);

    if (direction !== undefined) {
      const entry = WalletLedgerEntry.create({
        id: crypto.randomUUID(),
        walletId: wallet.id,
        transactionId: transaction.id,
        direction,
        money: transaction.money,
        balanceBefore: before,
        balanceAfter: wallet.balance,
      });

      await repos.ledger.save(entry);
    }

    const processedEvent = new WagerTransactionProcessed({
      eventId: crypto.randomUUID(),
      aggregateId: transaction.id,
      correlationId,
      data: {
        transactionId: transaction.id,
        walletId: wallet.id,
        kind: transaction.kind,
        money: transaction.money.toJSON(),
      },
    });

    await this.enqueueEvent(repos.outbox, processedEvent);

    if (direction !== undefined) {
      const balanceEvent = new WalletBalanceChanged({
        eventId: crypto.randomUUID(),
        aggregateId: wallet.id,
        correlationId,
        data: {
          transactionId: transaction.id,
          walletId: wallet.id,
          balanceBefore: before.toJSON(),
          balanceAfter: wallet.balance.toJSON(),
        },
      });

      await this.enqueueEvent(repos.outbox, balanceEvent);
    }

    return this.result(transaction, wallet.balance);
  }

  private async savePendingReference(
    repos: Repositories,
    transaction: WagerTransaction,
    wallet: Wallet,
    correlationId: string,
  ): Promise<void> {
    await repos.transactions.save(transaction, wallet.balance);

    const event = new WagerTransactionPendingReference({
      eventId: crypto.randomUUID(),
      aggregateId: transaction.id,
      correlationId,
      data: {
        transactionId: transaction.id,
        walletId: wallet.id,
        referenceExternalTransactionId:
          transaction.referenceExternalTransactionId!,
        nextReferenceAttemptAt:
          transaction.nextReferenceAttemptAt!.toISOString(),
      },
    });

    await this.enqueueEvent(repos.outbox, event);
  }

  private async saveRejection(
    repos: Repositories,
    transaction: WagerTransaction,
    wallet: Wallet,
    correlationId: string,
  ): Promise<void> {
    await repos.transactions.save(transaction, wallet.balance);

    const event = new WagerTransactionRejected({
      eventId: crypto.randomUUID(),
      aggregateId: transaction.id,
      correlationId,
      data: {
        transactionId: transaction.id,
        walletId: wallet.id,
        failureCode: transaction.failureCode!,
      },
    });

    await this.enqueueEvent(repos.outbox, event);
  }

  private validateReference(
    transaction: WagerTransaction,
    reference: WagerTransaction,
  ): string | undefined {
    if (reference.status !== WagerTransactionStatus.Processed) {
      return 'INVALID_REFERENCE_STATUS';
    }

    if (
      reference.providerId !== transaction.providerId ||
      reference.playerId !== transaction.playerId ||
      reference.walletId !== transaction.walletId ||
      reference.roundId !== transaction.roundId ||
      reference.money.currency !== transaction.money.currency ||
      !reference.money.equals(transaction.money)
    ) {
      return 'INVALID_REFERENCE';
    }

    if (
      transaction.kind === WagerTransactionKind.Refund &&
      reference.kind !== WagerTransactionKind.Bet
    ) {
      return 'INVALID_REFERENCE_TYPE';
    }

    if (
      transaction.kind === WagerTransactionKind.Rollback &&
      reference.kind !== WagerTransactionKind.Bet &&
      reference.kind !== WagerTransactionKind.Win &&
      reference.kind !== WagerTransactionKind.Refund
    ) {
      return 'INVALID_REFERENCE_TYPE';
    }

    return undefined;
  }

  private reverseDirection(
    kind: WagerTransactionKind,
  ): LedgerDirection {
    if (kind === WagerTransactionKind.Bet) {
      return LedgerDirection.Credit;
    }

    if (
      kind === WagerTransactionKind.Win ||
      kind === WagerTransactionKind.Refund
    ) {
      return LedgerDirection.Debit;
    }

    throw new Error('Unsupported reversal reference');
  }

  private result(
    transaction: WagerTransaction,
    balance: Money,
  ): ProcessWagerTransactionResult {
    return {
      transactionId: transaction.id,
      status: transaction.status,
      balance: balance.toString(),
      failureCode: transaction.failureCode,
      idempotentReplay: false,
    };
  }

  private async enqueueEvent(
    repository: OutboxMessageRepository,
    event: {
      eventId: string;
      aggregateId: string;
      eventType: string;
      occurredAt: Date;
      toJSON(): object;
    },
  ): Promise<void> {
    await repository.enqueue(
      OutboxMessage.enqueue({
        id: event.eventId,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: { ...event.toJSON() },
        occurredAt: event.occurredAt,
      }),
    );
  }
}

