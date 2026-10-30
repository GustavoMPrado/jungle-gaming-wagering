import {
  LockMode,
  type EntityManager,
} from '@mikro-orm/postgresql';
import {
  WagerTransactionRecord,
} from './wager-transaction-record.entity.js';

export class PendingReferenceRepository {
  public constructor(
    private readonly em: EntityManager,
  ) {}

  public async findDueIds(
    now: Date = new Date(),
    limit: number = 50,
  ): Promise<string[]> {
    if (!Number.isFinite(now.getTime())) {
      throw new Error('Invalid reference date');
    }

    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('Invalid reference query limit');
    }

    const records = await this.em.find(
      WagerTransactionRecord,
      {
        status: 'PENDING_REFERENCE',
        nextReferenceAttemptAt: {
          $lte: now,
        },
      },
      {
        orderBy: {
          nextReferenceAttemptAt: 'ASC',
          id: 'ASC',
        },
        limit,
      },
    );

    return records.map((record) => record.id);
  }

  public async findByIdForUpdate(
    id: string,
  ): Promise<WagerTransactionRecord | null> {
    return this.em.findOne(
      WagerTransactionRecord,
      { id },
      {
        lockMode: LockMode.PESSIMISTIC_WRITE,
        refresh: true,
      },
    );
  }

  public isDue(
    record: WagerTransactionRecord,
    now: Date = new Date(),
  ): boolean {
    if (!Number.isFinite(now.getTime())) {
      throw new Error('Invalid reference date');
    }

    return (
      record.status === 'PENDING_REFERENCE' &&
      record.nextReferenceAttemptAt != null &&
      record.nextReferenceAttemptAt.getTime() <= now.getTime()
    );
  }
}
