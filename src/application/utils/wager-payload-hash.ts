import { createHash } from 'node:crypto';
import { Money } from '../../domain/value-objects/money.js';
import { WagerTransactionKind } from '../../domain/entities/wager-transaction.js';

export interface WagerPayload {
  walletId: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  amount: string;
  currency: string;
  referenceExternalTransactionId?: string;
}

export function createWagerPayloadHash(
  payload: WagerPayload,
): string {
  const money = Money.create(
    payload.amount,
    payload.currency,
  );

  const canonicalPayload = {
    walletId: payload.walletId,
    providerId: payload.providerId,
    externalTransactionId: payload.externalTransactionId,
    playerId: payload.playerId,
    roundId: payload.roundId,
    gameId: payload.gameId,
    kind: payload.kind,
    amount: money.toString(),
    currency: money.currency,
    referenceExternalTransactionId:
      payload.referenceExternalTransactionId ?? null,
  };

  return createHash('sha256')
    .update(JSON.stringify(canonicalPayload), 'utf8')
    .digest('hex');
}
