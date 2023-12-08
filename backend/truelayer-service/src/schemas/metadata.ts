import { Schema } from 'mongoose';

// The required and optional fields are not so well documented here -
// https://docs.truelayer.com/reference/getme
// They are better documented here instead -
// https://docs.t7r.dev/#retrieve-access_token-metadata

export interface Metadata {
  client_id: string;
  credentials_id: string;
  consent_status: string;
  consent_status_updated_at?: string;
  consent_created_at?: string;
  consent_expires_at?: string;
  provider: Provider;
  privacy_policy: string;
}

export interface Provider {
  display_name: string;
  logo_uri: string;
  provider_id: string;
}

export const ProviderSchema = new Schema<Provider>({
  display_name: { type: String, required: true },
  logo_uri: { type: String, required: true },
  provider_id: { type: String, required: true },
});

export const MetadataSchema = new Schema<Metadata>({
  client_id: { type: String, required: true },
  credentials_id: { type: String, required: true },
  consent_status: { type: String, required: true },
  consent_status_updated_at: String,
  consent_created_at: String,
  consent_expires_at: String,
  provider: { type: ProviderSchema, required: true },
  privacy_policy: { type: String, required: true },
});
