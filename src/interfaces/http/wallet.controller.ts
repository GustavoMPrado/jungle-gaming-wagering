import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';

import { CreateWalletUseCase } from '../../application/use-cases/wallet/create-wallet.use-case.js';
import { GetWalletUseCase } from '../../application/use-cases/wallet/get-wallet.use-case.js';
import { GetWalletLedgerUseCase } from '../../application/use-cases/wallet/get-wallet-ledger.use-case.js';
import { ReconcileWalletUseCase } from '../../application/use-cases/wallet/reconcile-wallet.use-case.js';

interface MoneyBody {
  amount: string;
  currency: string;
}

interface CreateWalletBody {
  playerId: string;
  initialBalance: MoneyBody | string;
  currency?: string;
}

@Controller('wallets')
export class WalletController {
  public constructor(
    private readonly createWallet: CreateWalletUseCase,
    private readonly getWallet: GetWalletUseCase,
    private readonly getWalletLedger: GetWalletLedgerUseCase,
    private readonly reconcileWallet: ReconcileWalletUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  public async create(@Body() body: CreateWalletBody) {
    if (
      !body ||
      typeof body.playerId !== 'string' ||
      !body.playerId.trim()
    ) {
      throw new BadRequestException('Invalid wallet request');
    }

    let amount: string;
    let currency: string;

    if (typeof body.initialBalance === 'string') {
      amount = body.initialBalance;
      currency = body.currency ?? '';
    } else if (
      body.initialBalance &&
      typeof body.initialBalance.amount === 'string' &&
      typeof body.initialBalance.currency === 'string'
    ) {
      amount = body.initialBalance.amount;
      currency = body.initialBalance.currency;
    } else {
      throw new BadRequestException('Invalid wallet request');
    }

    if (
      !currency.trim() ||
      !/^\d+(\.\d{1,2})?$/.test(amount)
    ) {
      throw new BadRequestException('Invalid wallet request');
    }

    try {
      return await this.createWallet.execute({
        playerId: body.playerId,
        currency,
        initialBalance: amount,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Wallet already exists'
      ) {
        throw new ConflictException('Wallet already exists');
      }

      throw new ServiceUnavailableException('Unable to create wallet');
    }
  }

  @Post(':walletId/reconciliation')
  @HttpCode(HttpStatus.OK)
  public async reconcile(@Param('walletId') walletId: string) {
    this.validateWalletId(walletId);

    const result = await this.reconcileWallet.execute(walletId);

    if (!result) {
      throw new NotFoundException('Wallet not found');
    }

    if (!result.consistent) {
      console.error(JSON.stringify({
        event: 'wallet_reconciliation_mismatch',
        walletId: result.walletId,
        checkedEntries: result.checkedEntries,
      }));
    }

    return result;
  }

  @Get(':walletId/ledger')
  public async findLedger(
    @Param('walletId') walletId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitText?: string,
  ) {
    this.validateWalletId(walletId);

    let limit = 50;

    if (limitText !== undefined) {
      if (!/^\d+$/.test(limitText)) {
        throw new BadRequestException('Invalid ledger page limit');
      }

      limit = Number(limitText);

      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new BadRequestException('Invalid ledger page limit');
      }
    }

    try {
      const result = await this.getWalletLedger.execute({
        walletId,
        cursor,
        limit,
      });

      if (!result) {
        throw new NotFoundException('Wallet not found');
      }

      return result;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Invalid ledger cursor'
      ) {
        throw new BadRequestException('Invalid ledger cursor');
      }

      throw error;
    }
  }

  @Get(':walletId')
  public async findById(@Param('walletId') walletId: string) {
    this.validateWalletId(walletId);

    const wallet = await this.getWallet.execute(walletId);

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return wallet;
  }

  private validateWalletId(walletId: string): void {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        walletId,
      )
    ) {
      throw new BadRequestException('Invalid wallet ID');
    }
  }
}
