import { Schema } from 'mongoose';

export interface Account {
  account_id: string;
  account_type: string;
  account_number: AccountNumber;
  currency: string;
  display_name: string;
  update_timestamp: Date;
}

export interface AccountNumber {
  iban?: string;
  number?: string;
  sort_code?: string;
  swift_bic: string;
  bsb?: string;
}

export const AccountNumberSchema = new Schema<AccountNumber>({
  iban: String,
  number: String,
  sort_code: String,
  swift_bic: { type: String, required: true },
  bsb: String,
});

export const AccountSchema = new Schema<Account>({
  account_id: { type: String, required: true },
  account_type: { type: String, required: true },
  account_number: { type: AccountNumberSchema, required: true },
  currency: { type: String, required: true },
  display_name: { type: String, required: true },
  update_timestamp: { type: Date, required: true },
});
