import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
} from '@nestjs/common';

import { GetWagerTransactionUseCase } from '../../application/use-cases/wagering/get-wager-transaction.use-case.js';

@Controller('wagering/transactions')
export class WagerQueryController {
  public constructor(
    private readonly getWagerTransaction: GetWagerTransactionUseCase,
  ) {}

  @Get(':transactionId')
  public async findById(
    @Param('transactionId') transactionId: string,
  ) {
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(transactionId)) {
      throw new BadRequestException('Invalid transaction ID');
    }

    const transaction =
      await this.getWagerTransaction.execute(transactionId);

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    return transaction;
  }
}
