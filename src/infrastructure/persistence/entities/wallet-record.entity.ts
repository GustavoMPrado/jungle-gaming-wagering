import { DecimalType, EntitySchema } from '@mikro-orm/core';

export class WalletRecord {
  id!: string;
  playerId!: string;
  currency!: string;
  balance!: string;
  version!: number;
  createdAt!: Date;
  updatedAt!: Date;
}

export const WalletRecordSchema = new EntitySchema({
  class: WalletRecord,
  tableName: 'wallets',
  properties: {
    id: {
      type: 'uuid',
      primary: true,
    },
    playerId: {
      type: 'string',
      fieldName: 'player_id',
    },
    currency: {
      type: 'string',
    },
    balance: {
      type: DecimalType,
      columnType: 'numeric(20,2)',
    },
    version: {
      type: 'integer',
    },
    createdAt: {
      type: 'datetime',
      fieldName: 'created_at',
    },
    updatedAt: {
      type: 'datetime',
      fieldName: 'updated_at',
    },
  },
});
