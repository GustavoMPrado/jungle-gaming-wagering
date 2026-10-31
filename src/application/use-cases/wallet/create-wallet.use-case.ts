import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';

import { Money } from '../../../domain/value-objects/money.js';
import { Wallet } from '../../../domain/entities/wallet.js';
import {
  WagerTransaction,
} from '../../../domain/entities/wager-transaction.js';
import {
  WalletLedgerEntry,
  LedgerDirection,
} from '../../../domain/entities/wallet-ledger-entry.js';
import { OutboxMessage } from '../../../domain/entities/outbox-message.js';
import {
  WagerTransactionProcessed,
  WalletBalanceChanged,
} from '../../../domain/events/wager-events.js';

import { WalletRepository } from '../../../infrastructure/persistence/repository/wallet.repository.js';
import { WagerTransactionRepository } from '../../../infrastructure/persistence/repository/wager-transaction.repository.js';
import { WalletLedgerEntryRepository } from '../../../infrastructure/persistence/repository/wallet-ledger-entry.repository.js';
import { OutboxMessageRepository } from '../../../infrastructure/persistence/repository/outbox-message.repository.js';

export interface CreateWalletInput {
  playerId: string;
  currency: string;
  initialBalance: string;
}

export interface CreateWalletResult {
  walletId: string;
  playerId: string;
  currency: string;
  balance: string;
  version: number;
}

export class CreateWalletUseCase {
  public constructor(
    private readonly em: EntityManager,
  ) {}

  public async execute(
    input: CreateWalletInput,
  ): Promise<CreateWalletResult> {
    const initialBalance = Money.create(
      input.initialBalance,
      input.currency,
    );

    const wallet = Wallet.open({
      id: randomUUID(),
      playerId: input.playerId,
      initialBalance,
    });

    return this.em.fork().transactional(async (tx) => {
      const wallets = new WalletRepository(tx);
      const transactions = new WagerTransactionRepository(tx);
      const ledger = new WalletLedgerEntryRepository(tx);
      const outbox = new OutboxMessageRepository(tx);

      const existing = await wallets.findByPlayerAndCurrency(
        wallet.playerId,
        wallet.currency,
      );

      if (existing) {
        throw new Error('Wallet already exists');
      }

      await wallets.save(wallet);

      if (initialBalance.isPositive()) {
        const transaction = WagerTransaction.createOpening({
          id: randomUUID(),
          walletId: wallet.id,
          playerId: wallet.playerId,
          money: initialBalance,
        });

        const balanceBefore = Money.create(
          '0.00',
          wallet.currency,
        );

        const entry = WalletLedgerEntry.create({
          id: randomUUID(),
          walletId: wallet.id,
          transactionId: transaction.id,
          direction: LedgerDirection.Credit,
          money: initialBalance,
          balanceBefore,
          balanceAfter: wallet.balance,
        });

        await transactions.save(transaction, wallet.balance);
        await ledger.save(entry);

        const processedEvent = new WagerTransactionProcessed({
          eventId: randomUUID(),
          aggregateId: transaction.id,
          correlationId: transaction.id,
          data: {
            transactionId: transaction.id,
            walletId: wallet.id,
            kind: transaction.kind,
            money: initialBalance.toJSON(),
          },
        });

        const balanceEvent = new WalletBalanceChanged({
          eventId: randomUUID(),
          aggregateId: wallet.id,
          correlationId: transaction.id,
          data: {
            transactionId: transaction.id,
            walletId: wallet.id,
            direction: LedgerDirection.Credit,
            money: initialBalance.toJSON(),
            balanceBefore: balanceBefore.toJSON(),
            balanceAfter: wallet.balance.toJSON(),
            walletVersion: wallet.version,
          },
        });

        await outbox.enqueue(
          OutboxMessage.enqueue({
            id: processedEvent.eventId,
            aggregateId: processedEvent.aggregateId,
            eventType: processedEvent.eventType,
            payload: { ...processedEvent.toJSON() },
            occurredAt: processedEvent.occurredAt,
          }),
        );

        await outbox.enqueue(
          OutboxMessage.enqueue({
            id: balanceEvent.eventId,
            aggregateId: balanceEvent.aggregateId,
            eventType: balanceEvent.eventType,
            payload: { ...balanceEvent.toJSON() },
            occurredAt: balanceEvent.occurredAt,
          }),
        );
      }

      return {
        walletId: wallet.id,
        playerId: wallet.playerId,
        currency: wallet.currency,
        balance: wallet.balance.toString(),
        version: wallet.version,
      };
    });
  }
}
