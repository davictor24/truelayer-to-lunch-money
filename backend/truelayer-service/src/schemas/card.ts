import { Schema } from 'mongoose';

export interface Card {
  account_id: string;
  card_network: string;
  card_type: string;
  currency: string;
  display_name: string;
  partial_card_number: string;
  name_on_card?: string;
  valid_from?: Date;
  valid_to?: Date;
  update_timestamp: Date;
}

export const CardSchema = new Schema<Card>({
  account_id: { type: String, required: true },
  card_network: { type: String, required: true },
  card_type: { type: String, required: true },
  currency: { type: String, required: true },
  display_name: { type: String, required: true },
  partial_card_number: { type: String, required: true },
  name_on_card: String,
  valid_from: Date,
  valid_to: Date,
  update_timestamp: { type: Date, required: true },
});
