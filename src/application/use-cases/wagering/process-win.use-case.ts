import type { EntityManager } from '@mikro-orm/postgresql';
import { Money } from '../../../domain/value-objects/money.js';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../domain/entities/wager-transaction.js';
import {
  LedgerDirection,
  WalletLedgerEntry,
} from '../../../domain/entities/wallet-ledger-entry.js';
import {
  OutboxMessage,
} from '../../../domain/entities/outbox-message.js';
import {
  WagerTransactionProcessed,
  WalletBalanceChanged,
} from '../../../domain/events/wager-events.js';
import {
  WalletRepository,
} from '../../../infrastructure/persistence/repository/wallet.repository.js';
import {
  WagerTransactionRepository,
} from '../../../infrastructure/persistence/repository/wager-transaction.repository.js';
import {
  WalletLedgerEntryRepository,
} from '../../../infrastructure/persistence/repository/wallet-ledger-entry.repository.js';
import {
  OutboxMessageRepository,
} from '../../../infrastructure/persistence/repository/outbox-message.repository.js';
import {
  WagerTransactionRecord,
} from '../../../infrastructure/persistence/entities/wager-transaction-record.entity.js';

export interface ProcessWinInput {
  transactionId: string;
  ledgerId: string;
  processedEventId: string;
  balanceEventId: string;
  walletId: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  playerId: string;
  roundId: string;
  gameId: string;
  amount: string;
  currency: string;
  correlationId: string;
}

export interface ProcessWinResult {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: string;
  idempotentReplay: boolean;
}

export class ProcessWinUseCase {
  public constructor(
    private readonly em: EntityManager,
  ) {}

  public async execute(
    input: ProcessWinInput,
  ): Promise<ProcessWinResult> {
    const amount = Money.create(input.amount, input.currency);

    if (!amount.isPositive()) {
      throw new Error('Transaction amount must be positive');
    }

    return this.em.fork().transactional(async (tx) => {
      const wallets = new WalletRepository(tx);
      const transactions = new WagerTransactionRepository(tx);
      const entries = new WalletLedgerEntryRepository(tx);
      const outbox = new OutboxMessageRepository(tx);

      const wallet = await wallets.findByIdForUpdate(
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

      const previous = await tx.findOne(
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

        if (
          previous.resultBalance === undefined ||
          previous.resultBalance === null
        ) {
          throw new Error('Stored transaction result is incomplete');
        }

        return {
          transactionId: previous.id,
          status: previous.status as WagerTransactionStatus,
          balance: previous.resultBalance,
          idempotentReplay: true,
        };
      }

      const existingExternal = await transactions.findByExternalId(
        input.providerId,
        input.externalTransactionId,
      );

      if (existingExternal) {
        throw new Error('External transaction identifier conflict');
      }

      const transaction = WagerTransaction.create({
        id: input.transactionId,
        providerId: input.providerId,
        externalTransactionId: input.externalTransactionId,
        idempotencyKey: input.idempotencyKey,
        payloadHash: input.payloadHash,
        walletId: input.walletId,
        playerId: input.playerId,
        roundId: input.roundId,
        gameId: input.gameId,
        kind: WagerTransactionKind.Win,
        money: amount,
      });

      const balanceBefore = wallet.balance;

      wallet.credit(amount);
      transaction.markProcessed();

      const ledger = WalletLedgerEntry.create({
        id: input.ledgerId,
        walletId: wallet.id,
        transactionId: transaction.id,
        direction: LedgerDirection.Credit,
        money: amount,
        balanceBefore,
        balanceAfter: wallet.balance,
      });

      const eventProps = {
        aggregateId: transaction.id,
        correlationId: input.correlationId,
      };

      const processedEvent = new WagerTransactionProcessed({
        ...eventProps,
        eventId: input.processedEventId,
        data: {
          transactionId: transaction.id,
          walletId: wallet.id,
          kind: transaction.kind,
          money: amount.toJSON(),
        },
      });

      const balanceEvent = new WalletBalanceChanged({
        eventId: input.balanceEventId,
        aggregateId: wallet.id,
        correlationId: input.correlationId,
        data: {
          transactionId: transaction.id,
          walletId: wallet.id,
          balanceBefore: balanceBefore.toJSON(),
          balanceAfter: wallet.balance.toJSON(),
        },
      });

      const processedMessage = OutboxMessage.enqueue({
        id: processedEvent.eventId,
        aggregateId: processedEvent.aggregateId,
        eventType: processedEvent.eventType,
        payload: { ...processedEvent.toJSON() },
        occurredAt: processedEvent.occurredAt,
      });

      const balanceMessage = OutboxMessage.enqueue({
        id: balanceEvent.eventId,
        aggregateId: balanceEvent.aggregateId,
        eventType: balanceEvent.eventType,
        payload: { ...balanceEvent.toJSON() },
        occurredAt: balanceEvent.occurredAt,
      });

      await wallets.save(wallet);
      await transactions.save(transaction, wallet.balance);
      await entries.save(ledger);
      await outbox.enqueue(processedMessage);
      await outbox.enqueue(balanceMessage);

      return {
        transactionId: transaction.id,
        status: transaction.status,
        balance: wallet.balance.toString(),
        idempotentReplay: false,
      };
    });
  }
}
