import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Res,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Response } from 'express';

import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/entities/wager-transaction.js';
import {
  ProcessWagerTransactionUseCase,
} from '../../application/use-cases/wagering/process-wager-transaction.use-case.js';
import {
  createWagerPayloadHash,
  type WagerPayload,
} from '../../application/utils/wager-payload-hash.js';
import { MetricsService } from '../../infrastructure/observability/metrics.service.js';

@Controller('wagering/transactions')
export class WagerController {
  public constructor(
    private readonly processWager: ProcessWagerTransactionUseCase,
    private readonly metrics: MetricsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  public async create(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    if (
      typeof idempotencyKey !== 'string' ||
      !idempotencyKey.trim()
    ) {
      throw new BadRequestException(
        'Idempotency-Key header is required',
      );
    }

    const payload = this.validateBody(body);

    let payloadHash: string;

    try {
      payloadHash = createWagerPayloadHash(payload);
    } catch {
      throw new BadRequestException('Invalid transaction money');
    }

    const startedAt = performance.now();

    try {
      const result = await this.processWager.execute({
        ...payload,
        transactionId: randomUUID(),
        idempotencyKey: idempotencyKey.trim(),
        payloadHash,
        correlationId:
          typeof correlationId === 'string' &&
          correlationId.trim()
            ? correlationId.trim()
            : randomUUID(),
      });

      this.metrics.observeDuration(
        'wager_processing_duration_ms',
        performance.now() - startedAt,
      );

      if (result.idempotentReplay) {
        this.metrics.increment('wager_duplicates_total');
      } else {
        this.metrics.increment(
          `wager_transactions_${result.status.toLowerCase()}_total`,
        );
      }

      const formattedResult = {
        transactionId: result.transactionId,
        status: result.status,
        balance: {
          amount: result.balance,
          currency: payload.currency,
        },
        ...(result.failureCode
          ? { failureCode: result.failureCode }
          : {}),
        idempotentReplay: result.idempotentReplay,
      };

      if (
        result.status ===
        WagerTransactionStatus.PendingReference
      ) {
        response.status(HttpStatus.ACCEPTED);
      }

      if (
        result.status === WagerTransactionStatus.Rejected
      ) {
        throw new UnprocessableEntityException(formattedResult);
      }

      return formattedResult;
    } catch (error) {
      if (error instanceof UnprocessableEntityException) {
        throw error;
      }

      if (
        error instanceof Error &&
        (
          error.message === 'Idempotency conflict' ||
          error.message ===
            'External transaction identifier conflict'
        )
      ) {
        throw new ConflictException(error.message);
      }

      if (
        error instanceof Error &&
        error.message === 'Wallet not found'
      ) {
        throw new NotFoundException(error.message);
      }

      if (
        error instanceof Error &&
        error.message ===
          'Wallet ownership or currency mismatch'
      ) {
        throw new BadRequestException(error.message);
      }

      throw new ServiceUnavailableException(
        'Unable to process wager transaction',
      );
    }
  }

  private validateBody(body: unknown): WagerPayload {
    if (
      body === null ||
      typeof body !== 'object' ||
      Array.isArray(body)
    ) {
      throw new BadRequestException(
        'Invalid wager transaction request',
      );
    }

    const data = body as Record<string, unknown>;

    const requiredFields = [
      'walletId',
      'providerId',
      'externalTransactionId',
      'playerId',
      'roundId',
      'gameId',
    ];

    for (const field of requiredFields) {
      if (
        typeof data[field] !== 'string' ||
        !(data[field] as string).trim()
      ) {
        throw new BadRequestException(
          `Invalid or missing field: ${field}`,
        );
      }
    }

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        data.walletId as string,
      )
    ) {
      throw new BadRequestException('Invalid wallet ID');
    }

    if (
      data.money === null ||
      typeof data.money !== 'object' ||
      Array.isArray(data.money)
    ) {
      throw new BadRequestException(
        'Invalid transaction money',
      );
    }

    const money = data.money as Record<string, unknown>;
    const amount = money.amount;
    const currency = money.currency;

    if (
      typeof currency !== 'string' ||
      !currency.trim()
    ) {
      throw new BadRequestException(
        'Invalid transaction currency',
      );
    }

    if (
      typeof amount !== 'string' ||
      !/^\d+(\.\d{1,2})?$/.test(amount) ||
      /^0+(\.0{1,2})?$/.test(amount)
    ) {
      throw new BadRequestException(
        'Invalid transaction amount',
      );
    }

    const kinds = [
      WagerTransactionKind.Bet,
      WagerTransactionKind.Win,
      WagerTransactionKind.Loss,
      WagerTransactionKind.Refund,
      WagerTransactionKind.Rollback,
    ];

    if (
      !kinds.includes(data.kind as WagerTransactionKind)
    ) {
      throw new BadRequestException(
        'Invalid transaction kind',
      );
    }

    const kind = data.kind as WagerTransactionKind;

    if (
      (
        kind === WagerTransactionKind.Refund ||
        kind === WagerTransactionKind.Rollback
      ) &&
      (
        typeof data.referenceExternalTransactionId !==
          'string' ||
        !data.referenceExternalTransactionId.trim()
      )
    ) {
      throw new BadRequestException(
        'Reference transaction is required',
      );
    }

    if (
      data.referenceExternalTransactionId !== undefined &&
      (
        typeof data.referenceExternalTransactionId !==
          'string' ||
        !data.referenceExternalTransactionId.trim()
      )
    ) {
      throw new BadRequestException(
        'Invalid reference transaction',
      );
    }

    return {
      walletId: data.walletId as string,
      providerId: data.providerId as string,
      externalTransactionId:
        data.externalTransactionId as string,
      playerId: data.playerId as string,
      roundId: data.roundId as string,
      gameId: data.gameId as string,
      kind,
      amount,
      currency,
      referenceExternalTransactionId:
        data.referenceExternalTransactionId as
          string | undefined,
    };
  }
}
