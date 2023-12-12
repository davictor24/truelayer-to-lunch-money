import { Kafka, Producer } from 'kafkajs';
import jwt from 'jsonwebtoken';
import config from '../config';
import ConnectionModel from '../models/connection';
import { Connection, Token } from '../schemas/connection';
import { Metadata, Provider } from '../schemas/metadata';
import { Account } from '../schemas/account';
import { Card } from '../schemas/card';
import { encrypt, decrypt } from '../utils/encryption';

export interface DecodedState {
  name: string,
  url: string
}

interface Tokens {
  access_token: Token;
  refresh_token: Token;
}

interface Transactions {
  source: TransactionSource;
  transactions: Transaction[]
}

interface TransactionSource {
  account_id: string;
  name: string;
  connection_name: string;
  type: 'account' | 'card';
  sub_type: string;
  provider: string;
  balance?: number;
  currency: string;
}

interface Transaction {
  timestamp: string;
  description: string;
  amount: number;
  currency: string;
  status: 'cleared' | 'uncleared';
  transaction_type: string;
  transaction_category: string;
  transaction_classification: string[];
  normalised_provider_transaction_id?: string;
  merchant_name?: string;
}

export class TruelayerService {
  private producer: Producer;

  constructor() {
    const kafka = new Kafka({
      clientId: 'truelayer-service',
      brokers: config.kafka.brokers,
    });
    this.producer = kafka.producer();
  }

  getAuthURL(name: string, url: string): string {
    const state = jwt.sign(
      { name, url },
      config.truelayer.state.secret,
      { expiresIn: 300 },
    );
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: config.truelayer.clientId,
      // TODO: Integrate direct debits and standing orders too
      scope: 'info accounts balance cards transactions direct_debits standing_orders offline_access',
      redirect_uri: config.truelayer.redirectURI,
      providers: 'uk-ob-all uk-oauth-all',
      state,
    });
    return `${config.truelayer.authOrigin}?${query.toString()}`;
  }

  async getConnections(): Promise<Connection[]> {
    return ConnectionModel.find({}).exec();
  }

  decodeState(state: string): DecodedState {
    const decodedState = jwt.verify(
      state,
      config.truelayer.state.secret,
    ) as DecodedState;
    if (typeof decodedState.name !== 'string' || typeof decodedState.url !== 'string') {
      throw new Error('Invalid state');
    }
    return decodedState;
  }

  async createConnection(name: string, code: string): Promise<Connection> {
    // 1. Get tokens
    const tokens = await this.getTokens(code);

    // 2. Get connection metadata
    const metadata = await this.getConnectionMetadata(tokens.access_token.token);

    // 3. Get user full name
    const fullName = await this.getUserFullName(tokens.access_token.token);

    // 4. Get accounts
    const accounts = await this.getTransactionSources(
      'accounts',
      tokens.access_token.token,
    ) as Account[];

    // 5. Get cards
    const cards = await this.getTransactionSources(
      'cards',
      tokens.access_token.token,
    ) as Card[];

    // 6. Queue transaction sources
    await this.queueNewTransactionSources(name, metadata.provider, accounts, cards);

    // 7. Save all the information into the database
    const connection = await this.saveConnection(
      name,
      fullName,
      tokens.access_token,
      tokens.refresh_token,
      metadata,
      accounts,
      cards,
    );

    return connection;
  }

  async deleteConnection(name: string): Promise<void> {
    await ConnectionModel.deleteOne({ connection_name: name }).exec();
  }

  async queueTransactions(from?: Date): Promise<void> {
    const connections = await this.getConnections();
    await Promise.all(
      connections.map((connection) => this.queueTransactionsForConnection(
        connection,
        from,
      )),
    );
  }

  async queueTransactionsForConnectionName(
    name: string,
    from?: Date,
  ): Promise<void> {
    const connection = await ConnectionModel.find({ connection_name: name }).exec();
    if (connection.length > 0) {
      await this.queueTransactionsForConnection(connection[0], from);
    }
  }

  private async queueTransactionsForConnection(
    connection: Connection,
    from?: Date,
  ): Promise<void> {
    const accessToken = await this.getAccessToken(
      connection.connection_name,
      connection.access_token,
      connection.refresh_token,
    );
    if (!accessToken) {
      console.log('Cannot get access token to queue transactions');
      return;
    }

    const sources = this.mergeTransactionSources(
      connection.connection_name,
      connection.metadata.provider,
      connection.accounts,
      connection.cards,
    );
    await Promise.all(
      sources.map((source) => this.queueTransactionsForSource(
        connection.connection_name,
        accessToken.token,
        source,
        from ?? connection.last_synced,
      )),
    );
  }

  private async queueTransactionsForSource(
    connectionName: string,
    accessToken: string,
    source: TransactionSource,
    from: Date,
  ): Promise<void> {
    const now = new Date();
    const transactions = await this.getTransactions(
      accessToken,
      source,
      from,
      now,
    );
    await this.publishTransactions({ source, transactions });
    await ConnectionModel.findOneAndUpdate(
      { connection_name: connectionName },
      { last_synced: now },
    ).exec();
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
    const response = await fetch(`${config.truelayer.authOrigin}/connect/token`, {
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
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
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
    const metadata = (await response.json()).results[0];
    return metadata;
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
    sourceType: 'accounts' | 'cards',
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
    sourceType: 'accounts' | 'cards',
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

  private async queueNewTransactionSources(
    name: string,
    provider: Provider,
    accounts: Account[],
    cards: Card[],
  ): Promise<void> {
    const connectionTransactions: Transactions[] = [];
    const sources = this.mergeTransactionSources(name, provider, accounts, cards);
    sources.forEach((source) => {
      connectionTransactions.push({
        source,
        transactions: [],
      });
    });
    await Promise.all(
      connectionTransactions.map((transactions) => this.publishTransactions(transactions)),
    );
  }

  private mergeTransactionSources(
    name: string,
    provider: Provider,
    accounts: Account[],
    cards: Card[],
  ): TransactionSource[] {
    const sources: TransactionSource[] = [];
    accounts.forEach((account) => {
      sources.push({
        account_id: account.account_id,
        name: account.display_name,
        connection_name: name,
        type: 'account',
        sub_type: account.account_type,
        provider: provider.display_name,
        balance: account.balance,
        currency: account.currency,
      });
    });
    cards.forEach((card) => {
      sources.push({
        account_id: card.account_id,
        name: card.display_name,
        connection_name: name,
        type: 'card',
        sub_type: card.card_type,
        provider: provider.display_name,
        balance: card.balance,
        currency: card.currency,
      });
    });
    return sources;
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
      access_token: {
        token: await encrypt(accessToken.token),
        expires_in: accessToken.expires_in,
      },
      refresh_token: {
        token: await encrypt(refreshToken.token),
        expires_in: refreshToken.expires_in,
      },
      metadata,
      accounts,
      cards,
      last_synced: new Date(),
    };
    await ConnectionModel.findOneAndUpdate(filter, connection, { upsert: true }).exec();
    this.queueTransactionsForConnection(
      {
        ...connection,
        connection_name: connectionName,
      },
      new Date(Date.now() - 30 * 24 * 3600 * 1000),
    );
    return { ...filter, ...connection };
  }

  private async getAccessToken(
    connectionName: string,
    encryptedAccessToken: Token,
    encryptedRefreshToken: Token,
  ): Promise<Token | undefined> {
    if (this.shouldUseToken(encryptedAccessToken)) {
      return {
        token: await decrypt(encryptedAccessToken.token),
        expires_in: encryptedAccessToken.expires_in,
      };
    }
    if (this.shouldUseToken(encryptedRefreshToken)) {
      const refreshToken = await decrypt(encryptedRefreshToken.token);
      const newAccessToken = await this.refreshAccessToken(refreshToken);
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
    const response = await fetch(`${config.truelayer.authOrigin}/connect/token`, {
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
    newToken: Token,
  ): Promise<void> {
    const token: Token = {
      token: await encrypt(newToken.token),
      expires_in: newToken.expires_in,
    };
    await ConnectionModel.findOneAndUpdate(
      { connection_name: connectionName },
      { access_token: token },
    ).exec();
  }

  private async getTransactions(
    accessToken: string,
    source: TransactionSource,
    from: Date,
    to: Date,
  ): Promise<Transaction[]> {
    const query = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    });
    const requestHeaders = {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };
    const transactions = await Promise.all([
      this.getUnclearedTransactions(source, query, requestHeaders),
      this.getClearedTransactions(source, query, requestHeaders),
    ]);
    return transactions[0].concat(transactions[1]);
  }

  private async getUnclearedTransactions(
    source: TransactionSource,
    query: URLSearchParams,
    requestHeaders: { Accept: string, Authorization: string },
  ): Promise<Transaction[]> {
    const response = await fetch(
      `${config.truelayer.apiOrigin}/data/v1/${source.type}s/${source.account_id}/transactions/pending?${query.toString()}`,
      {
        method: 'GET',
        headers: requestHeaders,
      },
    );
    const transactions: Omit<Transaction, 'status'>[] = (await response.json()).results ?? [];
    return transactions.map((transaction) => ({
      ...transaction,
      status: 'uncleared',
    }));
  }

  private async getClearedTransactions(
    source: TransactionSource,
    query: URLSearchParams,
    requestHeaders: { Accept: string, Authorization: string },
  ): Promise<Transaction[]> {
    const response = await fetch(
      `${config.truelayer.apiOrigin}/data/v1/${source.type}s/${source.account_id}/transactions?${query.toString()}`,
      {
        method: 'GET',
        headers: requestHeaders,
      },
    );
    const transactions: Omit<Transaction, 'status'>[] = (await response.json()).results ?? [];
    return transactions.map((transaction) => ({
      ...transaction,
      status: 'cleared',
    }));
  }

  private async publishTransactions(transactions: Transactions): Promise<void> {
    if (transactions.transactions.length === 0 && !transactions.source.balance) {
      return;
    }
    await this.producer.connect();
    await this.producer.send({
      topic: config.kafka.topics.transactions,
      messages: [
        {
          key: `${transactions.source.connection_name}|${transactions.source.name}`,
          value: JSON.stringify(transactions),
        },
      ],
    });
  }
}

const truelayerService = new TruelayerService();
export default truelayerService;
