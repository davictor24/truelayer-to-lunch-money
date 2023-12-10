import { Kafka } from 'kafkajs';
import config from '../config';
import ConnectionModel from '../models/connection';
import { Connection, Token } from '../schemas/connection';
import { Metadata, Provider } from '../schemas/metadata';
import { Account } from '../schemas/account';
import { Card } from '../schemas/card';

interface Tokens {
  accessToken: Token;
  refreshToken: Token;
}

enum TransactionSourceType {
  accounts = 'accounts',
  cards = 'cards',
}

export class TruelayerService {
  async isNewConnectionName(name: string): Promise<boolean> {
    const records = await ConnectionModel.find({ connection_name: name }).exec();
    return records.length === 0;
  }

  getAuthURL(state: string): string {
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: config.truelayer.clientId,
      scope: 'info accounts balance cards transactions direct_debits standing_orders offline_access',
      redirect_uri: config.truelayer.redirectURI,
      providers: 'uk-ob-all uk-oauth-all',
      state,
    });
    return `${config.truelayer.apiOrigin}?${query.toString()}`;
  }

  async getConnections(): Promise<Connection[]> {
    return ConnectionModel.find({}).exec();
  }

  async createConnection(name: string, code: string): Promise<Connection> {
    // 1. Get tokens
    const tokens = await this.getTokens(code);

    // 2. Get connection metadata
    const metadata = await this.getConnectionMetadata(tokens.accessToken.token);

    // 3. Get user full name
    const fullName = await this.getUserFullName(tokens.refreshToken.token);

    // 4. Get accounts
    const accounts = await this.getTransactionSources(
      TransactionSourceType.accounts,
      tokens.accessToken.token,
    ) as Account[];

    // 5. Get cards
    const cards = await this.getTransactionSources(
      TransactionSourceType.cards,
      tokens.accessToken.token,
    ) as Card[];

    // 6. Queue new asset messages
    await this.queueNewAssets(name, metadata.provider, accounts, cards);

    // 7. Save all the information in the database
    const connection = await this.saveConnection(
      name,
      fullName,
      tokens.accessToken,
      tokens.refreshToken,
      metadata,
      accounts,
      cards,
    );

    return connection;
  }

  async deleteConnection(name: string): Promise<void> {
    await ConnectionModel.deleteOne({ connection_name: name }).exec();
  }

  async queueTransactions(connectionName?: string): Promise<void> {
    // TODO
    console.log('Called queueTransactions');
  }

  private async getTokens(code: string): Promise<Tokens> {
    const requestHeaders = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    const requestBody = {
      client_id: config.truelayer.clientId,
      client_secret: config.truelayer.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.truelayer.redirectURI,
    };
    const response = await fetch(`${config.truelayer.apiOrigin}/connect/token`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestBody),
    });

    const now = Date.now();
    const tokens = await response.json();
    const accessToken: Token = {
      token: tokens.access_token,
      expires_in: new Date(now + (tokens.expires_in * 1000)),
    };
    const refreshToken: Token = {
      token: tokens.refresh_token,
      expires_in: new Date(now + (90 * 24 * 3600 * 1000)),
    };
    return { accessToken, refreshToken };
  }

  private async getConnectionMetadata(accessToken: string): Promise<Metadata> {
    const requestHeaders = {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };
    const response = await fetch(`${config.truelayer.apiOrigin}/data/v1/me`, {
      method: 'GET',
      headers: requestHeaders,
    });
    return response.json();
  }

  private async getUserFullName(accessToken: string): Promise<string> {
    const requestHeaders = {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };
    const response = await fetch(`${config.truelayer.apiOrigin}/data/v1/info`, {
      method: 'GET',
      headers: requestHeaders,
    });
    const info = (await response.json()).results[0];
    return info.full_name;
  }

  private async getTransactionSources(
    sourceType: TransactionSourceType,
    accessToken: string,
  ): Promise<Account[] | Card[]> {
    const requestHeaders = {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };
    const response = await fetch(`${config.truelayer.apiOrigin}/data/v1/${sourceType}`, {
      method: 'GET',
      headers: requestHeaders,
    });
    if (response.status === 501) {
      return [];
    }
    const sources: Account[] | Card[] = (await response.json()).results;

    const balances = await Promise.all(
      sources.map((source) => this.getBalance(source.account_id, sourceType, accessToken)),
    );
    for (let i = 0; i < sources.length; i += 1) {
      sources[i].balance = balances[i];
    }
    return sources;
  }

  private async getBalance(
    accountID: string,
    sourceType: TransactionSourceType,
    accessToken: string,
  ): Promise<number> {
    const requestHeaders = {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };
    const response = await fetch(`${config.truelayer.apiOrigin}/data/v1/${sourceType}/${accountID}/balance`, {
      method: 'GET',
      headers: requestHeaders,
    });
    const balance = (await response.json()).results[0];
    return balance.current;
  }

  private async queueNewAssets(
    name: string,
    provider: Provider,
    accounts: Account[],
    cards: Card[],
  ): Promise<void> {
    // TODO
    console.log('Called queueNewAssets');
  }

  private async saveConnection(
    connectionName: string,
    fullName: string,
    accessToken: Token,
    refreshToken: Token,
    metadata: Metadata,
    accounts: Account[],
    cards: Card[],
  ): Promise<Connection> {
    const filter = { connection_name: connectionName };
    const connection: Omit<Connection, 'connection_name'> = {
      full_name: fullName,
      access_token: accessToken,
      refresh_token: refreshToken,
      metadata,
      accounts,
      cards,
      last_synced: new Date(),
    };
    await ConnectionModel.findOneAndUpdate(filter, connection, { upsert: true }).exec();
    return { ...filter, ...connection };
  }

  private async getAccessToken(connectionName: string): Promise<Token | undefined> {
    const connections = await ConnectionModel.find({ connection_name: connectionName })
      .select('access_token refresh_token')
      .exec();
    const accessToken = connections[0].access_token;
    const refreshToken = connections[0].refresh_token;

    if (this.shouldUseToken(accessToken)) {
      return accessToken;
    }

    if (this.shouldUseToken(refreshToken)) {
      const newAccessToken = await this.refreshAccessToken(refreshToken.token);
      await this.saveNewAccessToken(connectionName, newAccessToken);
      return newAccessToken;
    }

    return undefined;
  }

  private shouldUseToken(token: Token): boolean {
    return token.expires_in.getTime() - Date.now() >= 30 * 1000;
  }

  private async refreshAccessToken(refreshToken: string): Promise<Token> {
    const requestHeaders = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    const requestBody = {
      client_id: config.truelayer.clientId,
      client_secret: config.truelayer.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    };
    const response = await fetch(`${config.truelayer.apiOrigin}/connect/token`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestBody),
    });

    const now = Date.now();
    const tokens = await response.json();
    return {
      token: tokens.access_token,
      expires_in: new Date(now + (tokens.expires_in * 1000)),
    };
  }

  private async saveNewAccessToken(
    connectionName: string,
    token: Token,
  ): Promise<void> {
    await ConnectionModel.findOneAndUpdate(
      { connection_name: connectionName },
      { access_token: token },
    ).exec();
  }

  private async getTransactions(accessToken: string) {
    // TODO
    console.log('Called getTransactions');
  }
}

const truelayerService = new TruelayerService();
export default truelayerService;
