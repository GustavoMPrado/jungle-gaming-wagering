import { describe, expect, it } from 'bun:test';

import {
  createWagerPayloadHash,
  type WagerPayload,
} from '../../src/application/utils/wager-payload-hash.js';

import {
  WagerTransactionKind,
} from '../../src/domain/entities/wager-transaction.js';

describe('createWagerPayloadHash', () => {
  function createPayload(): WagerPayload {
    return {
      walletId: 'wallet-1',
      providerId: 'provider-1',
      externalTransactionId: 'transaction-1',
      playerId: 'player-1',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      amount: '10.00',
      currency: 'BRL',
    };
  }

  it('should produce the same hash for the same payload', () => {
    const payload = createPayload();

    const first = createWagerPayloadHash(payload);
    const second = createWagerPayloadHash(payload);

    expect(first).toBe(second);
    expect(first).toHaveLength(64);
  });

  it('should normalize equivalent monetary amounts', () => {
    const payload = createPayload();

    const first = createWagerPayloadHash({
      ...payload,
      amount: '10',
    });

    const second = createWagerPayloadHash({
      ...payload,
      amount: '10.0',
    });

    const third = createWagerPayloadHash({
      ...payload,
      amount: '10.00',
    });

    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it('should produce different hashes for different amounts', () => {
    const payload = createPayload();

    const first = createWagerPayloadHash(payload);

    const second = createWagerPayloadHash({
      ...payload,
      amount: '20.00',
    });

    expect(first).not.toBe(second);
  });

  it('should produce different hashes for different transaction kinds', () => {
    const payload = createPayload();

    const first = createWagerPayloadHash(payload);

    const second = createWagerPayloadHash({
      ...payload,
      kind: WagerTransactionKind.Win,
    });

    expect(first).not.toBe(second);
  });

  it('should include the reference identifier', () => {
    const payload = {
      ...createPayload(),
      kind: WagerTransactionKind.Refund,
    };

    const first = createWagerPayloadHash({
      ...payload,
      referenceExternalTransactionId: 'bet-1',
    });

    const second = createWagerPayloadHash({
      ...payload,
      referenceExternalTransactionId: 'bet-2',
    });

    expect(first).not.toBe(second);
  });

  it('should treat missing and undefined references equally', () => {
    const payload = createPayload();

    const first = createWagerPayloadHash(payload);

    const second = createWagerPayloadHash({
      ...payload,
      referenceExternalTransactionId: undefined,
    });

    expect(first).toBe(second);
  });
});
