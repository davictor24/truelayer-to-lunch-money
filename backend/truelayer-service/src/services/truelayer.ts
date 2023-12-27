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
  status: 'cleared' | 'pending';
  transaction_type: string;
  transaction_category: string;
  transaction_classification: string[];
  normalised_provider_transaction_id?: string;
  merchant_name?: string;
}

function dateDaysAgo(date: Date, daysAgo: number): Date {
  return new Date(date.getTime() - daysAgo * 24 * 3600 * 1000);
}

export class TruelayerService {
  private static readonly WAY_BACK_DAYS = 30;

  private producer: Producer;

  constructor() {
    const kafka = new Kafka({
      clientId: 'truelayer-service',
      brokers: config.kafka.brokers,
    });
    this.producer = kafka.producer();
  }

  getAuthURL(name: string, url: string): string {
    if (!config.truelayer.state.secret) {
      throw new Error('TRUELAYER_STATE_SECRET environment variable not specified');
    }
    if (!config.truelayer.clientID) {
      throw new Error('TRUELAYER_CLIENT_ID environment variable not specified');
    }
    if (!config.truelayer.redirectURI) {
      throw new Error('TRUELAYER_REDIRECT_URI environment variable not specified');
    }

    const state = jwt.sign(
      { name, url },
      config.truelayer.state.secret,
      { expiresIn: 300 },
    );
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: config.truelayer.clientID,
      // TODO: Get data on direct debits and standing orders too, since we have permission
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
    if (!config.truelayer.state.secret) {
      throw new Error('TRUELAYER_STATE_SECRET environment variable not specified');
    }

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
      'account',
      tokens.access_token.token,
    ) as Account[];

    // 5. Get cards
    const cards = await this.getTransactionSources(
      'card',
      tokens.access_token.token,
    ) as Card[];

    // 6. Save all the information into the database
    const connection = await this.saveConnection(
      name,
      fullName,
      tokens.access_token,
      tokens.refresh_token,
      metadata,
      accounts,
      cards,
    );

    // 7. Sync transactions which happened within the past WAY_BACK_DAYS days
    this.queueTransactionsForConnectionWayBack(connection);

    return connection;
  }

  async deleteConnection(name: string): Promise<void> {
    await ConnectionModel.deleteOne({ connection_name: name }).exec();
  }

  async queueTransactions(
    since?: Date,
    includeCurrentBalance?: boolean,
  ): Promise<void> {
    const connections = await this.getConnections();
    await Promise.all(
      connections.map((connection) => this.queueTransactionsForConnection(
        connection,
        since,
        includeCurrentBalance,
      )),
    );
  }

  async queueTransactionsWayBack(): Promise<void> {
    await this.queueTransactions(
      dateDaysAgo(new Date(), TruelayerService.WAY_BACK_DAYS),
      true,
    );
  }

  async queueTransactionsForConnectionName(
    name: string,
    since?: Date,
    includeCurrentBalance?: boolean,
  ): Promise<void> {
    const connection = await ConnectionModel.find({ connection_name: name }).exec();
    if (connection.length > 0) {
      await this.queueTransactionsForConnection(
        connection[0],
        since,
        includeCurrentBalance,
      );
    }
  }

  async queueTransactionsForConnectionNameWayBack(name: string): Promise<void> {
    await this.queueTransactionsForConnectionName(
      name,
      dateDaysAgo(new Date(), TruelayerService.WAY_BACK_DAYS),
      true,
    );
  }

  private async queueTransactionsForConnection(
    connection: Connection,
    since?: Date,
    includeCurrentBalance?: boolean,
  ): Promise<void> {
    try {
      const accessToken = await this.getAccessToken(
        connection.connection_name,
        connection.access_token,
        connection.refresh_token,
      );
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
          since ?? connection.last_synced,
          includeCurrentBalance ?? false,
        )),
      );
    } catch (err) {
      console.log(
        `Something went wrong when queueing transactions for ${connection.connection_name}`,
      );
      throw err;
    }
  }

  async queueTransactionsForConnectionWayBack(connection: Connection): Promise<void> {
    await this.queueTransactionsForConnection(
      connection,
      dateDaysAgo(new Date(), TruelayerService.WAY_BACK_DAYS),
      true,
    );
  }

  private async queueTransactionsForSource(
    connectionName: string,
    accessToken: string,
    source: TransactionSource,
    since: Date,
    includeCurrentBalance: boolean,
  ): Promise<void> {
    console.log(`Queueing transactions for ${connectionName} / ${source.name} since ${since}`);
    const now = new Date();
    const transactions = await this.getTransactions(
      accessToken,
      source,
      since,
      now,
    );
    const updatedSource = source;
    if (includeCurrentBalance || transactions.length > 0) {
      const balance = await this.getBalance(source.account_id, source.type, accessToken);
      updatedSource.balance = balance;
    }
    await this.publishTransactions({ source: updatedSource, transactions });
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
      client_id: config.truelayer.clientID,
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
    if (response.status !== 200) {
      await this.throwFetchError(response, 'tokens');
    }

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
    if (response.status !== 200) {
      await this.throwFetchError(response, 'connection metadata');
    }
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
    if (response.status !== 200) {
      await this.throwFetchError(response, 'user info');
    }
    const info = (await response.json()).results[0];
    return info.full_name;
  }

  private async getTransactionSources(
    sourceType: 'account' | 'card',
    accessToken: string,
  ): Promise<Account[] | Card[]> {
    const requestHeaders = {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };
    const response = await fetch(`${config.truelayer.apiOrigin}/data/v1/${sourceType}s`, {
      method: 'GET',
      headers: requestHeaders,
    });
    if (response.status === 501) {
      return [];
    }
    if (response.status !== 200) {
      await this.throwFetchError(response, `${sourceType}s`);
    }
    const sources: Account[] | Card[] = (await response.json()).results;
    return sources;
  }

  private async getBalance(
    accountID: string,
    sourceType: 'account' | 'card',
    accessToken: string,
  ): Promise<number> {
    const requestHeaders = {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };
    const response = await fetch(`${config.truelayer.apiOrigin}/data/v1/${sourceType}s/${accountID}/balance`, {
      method: 'GET',
      headers: requestHeaders,
    });
    if (response.status !== 200) {
      await this.throwFetchError(response, `balance for ${sourceType} with ID ${accountID}`);
    }
    const balance = (await response.json()).results[0];
    let { current } = balance;

    // Only noticed this issue with Monzo Flex since it uses a different sign convention.
    // Might work too for others (if any) using a negative sign convention for credit cards.
    if (sourceType === 'card' && balance.available && balance.available < 0) {
      current *= -1;
    }

    return current;
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
    return { ...filter, ...connection };
  }

  private async getAccessToken(
    connectionName: string,
    encryptedAccessToken: Token,
    encryptedRefreshToken: Token,
  ): Promise<Token> {
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
    throw new Error(`Cannot get access token for ${connectionName}`);
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
      client_id: config.truelayer.clientID,
      client_secret: config.truelayer.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    };
    const response = await fetch(`${config.truelayer.authOrigin}/connect/token`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestBody),
    });
    if (response.status !== 200) {
      await this.throwFetchError(response, 'access token');
    }

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
      this.getPendingTransactions(source, query, requestHeaders),
      this.getClearedTransactions(source, query, requestHeaders),
    ]);
    return transactions[0].concat(transactions[1]);
  }

  private async getPendingTransactions(
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
    if (response.status !== 200) {
      await this.throwFetchError(
        response,
        `pending transactions for source ${source.name} (connection ${source.connection_name})`,
      );
    }
    const transactions: Omit<Transaction, 'status'>[] = (await response.json()).results ?? [];
    return transactions.map((transaction) => ({
      ...transaction,
      status: 'pending',
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
    if (response.status !== 200) {
      await this.throwFetchError(
        response,
        `cleared transactions for source ${source.name} (connection ${source.connection_name})`,
      );
    }
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

  private async throwFetchError(response: Response, what: string): Promise<never> {
    throw new Error(`An error occurred when fetching ${what}\n${await response.text()}`);
  }
}

const truelayerService = new TruelayerService();
export default truelayerService;
