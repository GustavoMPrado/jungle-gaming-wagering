import type { EntityManager } from '@mikro-orm/postgresql';

import { WagerTransactionRepository } from '../../../infrastructure/persistence/repository/wager-transaction.repository.js';

export class GetWagerTransactionUseCase {
  public constructor(
    private readonly em: EntityManager,
  ) {}

  public async execute(transactionId: string) {
    const repository = new WagerTransactionRepository(
      this.em.fork(),
    );

    const transaction = await repository.findById(transactionId);

    if (!transaction) {
      return null;
    }

    return {
      transactionId: transaction.id,
      status: transaction.status,
    };
  }

  public async findByExternalId(
    providerId: string,
    externalTransactionId: string,
  ) {
    const repository = new WagerTransactionRepository(
      this.em.fork(),
    );

    const transaction = await repository.findByExternalId(
      providerId,
      externalTransactionId,
    );

    if (!transaction) {
      return null;
    }

    return {
      transactionId: transaction.id,
      status: transaction.status,
    };
  }
}
