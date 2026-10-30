import type { EntityManager } from '@mikro-orm/postgresql';
import { WalletRepository } from '../../../infrastructure/persistence/repository/wallet.repository.js';
export interface GetWalletResult {
  walletId: string;
  playerId: string;
  currency: string;
  balance: string;
  version: number;
}

export class GetWalletUseCase {
  public constructor(
    private readonly em: EntityManager,
  ) {}

  public async execute(
    walletId: string,
  ): Promise<GetWalletResult | null> {
    const wallets = new WalletRepository(this.em.fork());

    const wallet = await wallets.findById(walletId);

    if (!wallet) {
      return null;
    }

    return {
      walletId: wallet.id,
      playerId: wallet.playerId,
      currency: wallet.currency,
      balance: wallet.balance.toString(),
      version: wallet.version,
    };
  }
}
