import { Schema } from 'mongoose';
import { Metadata, MetadataSchema } from './metadata';
import { Account, AccountSchema } from './account';
import { Card, CardSchema } from './card';

export interface Connection {
  connection_name: string;
  full_name: string;
  access_token: Token;
  refresh_token: Token;
  metadata: Metadata;
  accounts: Account[];
  cards: Card[];
  last_synced: Date;
}

export interface Token {
  token: string;
  expires_in: Date;
}

export const TokenSchema = new Schema<Token>({
  token: { type: String, required: true },
  expires_in: { type: Date, required: true },
});

export const ConnectionSchema = new Schema<Connection>({
  connection_name: { type: String, required: true, unique: true },
  full_name: { type: String, required: true },
  access_token: { type: TokenSchema, required: true },
  refresh_token: { type: TokenSchema, required: true },
  metadata: { type: MetadataSchema, required: true },
  accounts: { type: [AccountSchema], required: true },
  cards: { type: [CardSchema], required: true },
  last_synced: { type: Date, required: true },
});
