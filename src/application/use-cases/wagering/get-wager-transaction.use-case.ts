import type { EntityManager } from '@mikro-orm/postgresql';

import { WagerTransactionRepository } from '../../../infrastructure/persistence/repository/wager-transaction.repository.js';

export class GetWagerTransactionUseCase {
  public constructor(
    private readonly em: EntityManager,
  ) {}

  public async execute(transactionId: string) {
    const repository = new WagerTransactionRepository(this.em);

    const transaction = await repository.findById(transactionId);

    if (!transaction) {
      return null;
    }

    return {
      transactionId: transaction.id,
      status: transaction.status,
    };
  }
}
