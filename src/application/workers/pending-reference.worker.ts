import type { EntityManager } from '@mikro-orm/postgresql';
import { PendingReferenceRepository } from '../../infrastructure/persistence/pending-reference.repository.js';
import {
  ProcessWagerTransactionUseCase,
  type ProcessWagerTransactionResult,
} from '../use-cases/process-wager-transaction.use-case.js';

export class PendingReferenceWorker {
  public constructor(
    private readonly em: EntityManager,
  ) {}

  public async runOnce(
    now: Date = new Date(),
    limit: number = 50,
  ): Promise<ProcessWagerTransactionResult[]> {
    const repository = new PendingReferenceRepository(
      this.em.fork(),
    );

    const ids = await repository.findDueIds(now, limit);

    const results: ProcessWagerTransactionResult[] = [];
    const useCase = new ProcessWagerTransactionUseCase(this.em);

    for (const id of ids) {
      const result = await useCase.resumePendingReference(
        id,
        now,
      );

      // Another worker may have already processed this transaction.
      if (result !== null) {
        results.push(result);
      }
    }

    return results;
  }
}
