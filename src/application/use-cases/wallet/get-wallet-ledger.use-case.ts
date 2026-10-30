import type { EntityManager } from '@mikro-orm/postgresql';
import {
  WalletLedgerEntryRepository,
  type LedgerCursor,
} from '../../../infrastructure/persistence/repository/wallet-ledger-entry.repository.js';
import { WalletRepository } from '../../../infrastructure/persistence/repository/wallet.repository.js';

interface CursorData {
  createdAt: string;
  id: string;
}

export interface GetWalletLedgerInput {
  walletId: string;
  limit?: number;
  cursor?: string;
}

export interface GetWalletLedgerResult {
  entries: {
    id: string;
    transactionId: string;
    direction: string;
    amount: string;
    currency: string;
    balanceBefore: string;
    balanceAfter: string;
    createdAt: string;
  }[];
  nextCursor: string | null;
  hasMore: boolean;
}

export class GetWalletLedgerUseCase {
  public constructor(
    private readonly em: EntityManager,
  ) {}

  public async execute(
    input: GetWalletLedgerInput,
  ): Promise<GetWalletLedgerResult | null> {
    const limit = input.limit ?? 50;

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Invalid ledger page limit');
    }

    const em = this.em.fork();
    const walletRepository = new WalletRepository(em);
    const ledgerRepository = new WalletLedgerEntryRepository(em);

    const wallet = await walletRepository.findById(
      input.walletId,
    );

    if (!wallet) {
      return null;
    }

    const cursor = input.cursor
      ? this.decodeCursor(input.cursor)
      : undefined;

    const page = await ledgerRepository.findPageByWalletId(
      input.walletId,
      limit,
      cursor,
    );

    const entries = page.entries.map((entry) => ({
      id: entry.id,
      transactionId: entry.transactionId,
      direction: entry.direction,
      amount: entry.money.toString(),
      currency: entry.money.currency,
      balanceBefore: entry.balanceBefore.toString(),
      balanceAfter: entry.balanceAfter.toString(),
      createdAt: entry.createdAt.toISOString(),
    }));

    const lastEntry = page.entries.at(-1);

    const nextCursor =
      page.hasMore && lastEntry
        ? this.encodeCursor({
            createdAt: lastEntry.createdAt.toISOString(),
            id: lastEntry.id,
          })
        : null;

    return {
      entries,
      nextCursor,
      hasMore: page.hasMore,
    };
  }

  private encodeCursor(data: CursorData): string {
    return Buffer.from(
      JSON.stringify(data),
      'utf8',
    ).toString('base64url');
  }

  private decodeCursor(value: string): LedgerCursor {
    try {
      const decoded = JSON.parse(
        Buffer.from(value, 'base64url').toString('utf8'),
      ) as CursorData;

      if (
        !decoded ||
        typeof decoded.createdAt !== 'string' ||
        typeof decoded.id !== 'string' ||
        !Number.isFinite(
          new Date(decoded.createdAt).getTime(),
        ) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          decoded.id,
        )
      ) {
        throw new Error('Invalid ledger cursor');
      }

      return {
        createdAt: new Date(decoded.createdAt),
        id: decoded.id,
      };
    } catch {
      throw new Error('Invalid ledger cursor');
    }
  }
}
