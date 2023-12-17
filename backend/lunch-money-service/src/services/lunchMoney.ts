import { Kafka, Consumer } from 'kafkajs';
import config from '../config';

type LunchMoneyAssetKey = string;
type LunchMoneyAssetID = number;

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

interface LunchMoneyAsset {
  type_name: string;
  subtype_name: string;
  name: string;
  display_name?: string;
  balance?: string;
  currency: string;
  institution_name: string;
}

interface LunchMoneyTransactions {
  transactions: LunchMoneyTransaction[];
  apply_rules: boolean;
  skip_duplicates: boolean;
  check_for_recurring: boolean;
  debit_as_negative: boolean;
  skip_balance_update: boolean;
}

interface LunchMoneyTransaction {
  date: string;
  amount: number | string;
  payee: string;
  currency: string;
  asset_id: number;
  status: 'cleared' | 'uncleared';
  external_id?: string;
}

export class LunchMoneyService {
  private consumer: Consumer;

  // TODO: Consider using Redis
  private cachedAssetIDs = new Map<LunchMoneyAssetKey, LunchMoneyAssetID>();

  constructor() {
    const kafka = new Kafka({
      clientId: 'lunch-money-service',
      brokers: config.kafka.brokers,
    });
    this.consumer = kafka.consumer({ groupId: 'main' });
  }

  async startConsumer(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: config.kafka.topics.transactions });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        const transactions = JSON.parse(message.value.toString());
        await this.processTransactions(transactions);
      },
    });
  }

  private async processTransactions(transactions: Transactions): Promise<void> {
    const asset = this.transformTransactionSource(transactions.source);
    const assetKey = this.getAssetKey(asset);
    let assetID: LunchMoneyAssetID;

    if (this.cachedAssetIDs.has(assetKey)) {
      // 1. If we have the asset cached, use it
      assetID = this.cachedAssetIDs.get(assetKey);
    } else {
      // 2. Else, update the cache and get the asset if it now exists
      await this.updateCachedAssets();
      if (this.cachedAssetIDs.has(assetKey)) {
        assetID = this.cachedAssetIDs.get(assetKey);
      }
    }

    if (!assetID) {
      // 3. If we still don't have the asset, create it and update the cache
      assetID = await this.createAsset(asset);
      this.cachedAssetIDs.set(assetKey, assetID);
    } else if (transactions.source.balance) {
      // 4. If we have the asset, update the balance if a new one was specified
      const balance = String(transactions.source.balance);
      await this.updateAssetBalance(assetID, balance);
    }

    // 5. Process the transactions, if any exists
    if (transactions.transactions.length > 0) {
      const transformedTransactionsArr = this.transformTransactions(
        transactions,
        assetID,
        asset.type_name === 'cash',
      );
      await Promise.all(
        transformedTransactionsArr.map(
          (transformedTransactions) => this.insertTransactions(transformedTransactions),
        ),
      );
    }
  }

  private transformTransactionSource(source: TransactionSource): LunchMoneyAsset {
    const sourceType = source.type.toLowerCase();
    let typeName: string;
    if (sourceType === 'account') {
      typeName = 'cash';
    } else if (sourceType === 'card') {
      typeName = 'credit';
    } else {
      throw new Error('Invalid transaction source type');
    }

    const sourceSubtype = source.sub_type.toLowerCase();
    let subtypeName: string;
    if (sourceSubtype === 'transaction' || sourceSubtype === 'business_transaction') {
      subtypeName = 'checking';
    } else if (sourceSubtype === 'savings' || sourceSubtype === 'business_savings') {
      subtypeName = 'savings';
    } else if (sourceSubtype === 'credit') {
      subtypeName = 'credit card';
    } else {
      throw new Error('Invalid transaction source subtype');
    }

    return {
      type_name: typeName,
      subtype_name: subtypeName,
      name: source.name,
      display_name: source.name,
      balance: source.balance ? String(source.balance) : undefined,
      currency: source.currency.toLowerCase(),
      // Abusing the intention of this field,
      // but it organises everything very nicely.
      institution_name: source.connection_name,
    };
  }

  private transformTransactions(
    transactions: Transactions,
    assetID: LunchMoneyAssetID,
    isCashAsset: boolean,
  ): LunchMoneyTransactions[] {
    const clearedTransactions: LunchMoneyTransaction[] = [];
    const unclearedTransactions: LunchMoneyTransaction[] = [];
    transactions.transactions.forEach((transaction) => {
      const transformedTransaction = this.transformTransaction(transaction, assetID);
      if (transformedTransaction.status === 'cleared') {
        clearedTransactions.push(transformedTransaction);
      } else {
        unclearedTransactions.push(transformedTransaction);
      }
    });
    console.log(
      `Transformed ${clearedTransactions.length} cleared transactions `
      + `and ${unclearedTransactions.length} uncleared transactions `
      + `for asset ID ${assetID}`,
    );

    return [{
      transactions: clearedTransactions,
      apply_rules: true,
      skip_duplicates: true,
      check_for_recurring: true,
      debit_as_negative: isCashAsset,
      // If there was a new balance specified, the asset has already been,
      // or will be updated in a different request
      skip_balance_update: transactions.source.balance !== undefined,
    },
    {
      transactions: unclearedTransactions,
      apply_rules: true,
      skip_duplicates: true,
      check_for_recurring: true,
      debit_as_negative: isCashAsset,
      // Don't update balance for uncleared transactions
      skip_balance_update: true,
    }];
  }

  private transformTransaction(
    transaction: Transaction,
    assetID: LunchMoneyAssetID,
  ): LunchMoneyTransaction {
    return {
      date: transaction.timestamp,
      amount: transaction.amount,
      payee: transaction.description,
      currency: transaction.currency.toLowerCase(),
      asset_id: assetID,
      status: transaction.status,
      external_id: transaction.normalised_provider_transaction_id,
    };
  }

  private async getAssets(): Promise<(LunchMoneyAsset & { id: LunchMoneyAssetID })[]> {
    const requestHeaders = {
      Authorization: `Bearer ${config.lunchMoney.accessToken}`,
    };
    const response = await fetch(`${config.lunchMoney.apiOrigin}/v1/assets`, {
      method: 'GET',
      headers: requestHeaders,
    });
    return (await response.json()).assets;
  }

  private async createAsset(asset: LunchMoneyAsset): Promise<LunchMoneyAssetID> {
    const requestHeaders = {
      Authorization: `Bearer ${config.lunchMoney.accessToken}`,
      'Content-Type': 'application/json',
    };
    const requestBody = {
      ...asset,
      balance: asset.balance ?? '0',
    };
    const response = await fetch(`${config.lunchMoney.apiOrigin}/v1/assets`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestBody),
    });
    return (await response.json()).id;
  }

  private async updateAssetBalance(assetID: LunchMoneyAssetID, balance: string): Promise<void> {
    const requestHeaders = {
      Authorization: `Bearer ${config.lunchMoney.accessToken}`,
      'Content-Type': 'application/json',
    };
    await fetch(`${config.lunchMoney.apiOrigin}/v1/assets/${assetID}`, {
      method: 'PUT',
      headers: requestHeaders,
      body: JSON.stringify({ balance }),
    });
  }

  private async insertTransactions(transactions: LunchMoneyTransactions): Promise<void> {
    const requestHeaders = {
      Authorization: `Bearer ${config.lunchMoney.accessToken}`,
      'Content-Type': 'application/json',
    };
    await fetch(`${config.lunchMoney.apiOrigin}/v1/transactions`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(transactions),
    });
  }

  private getAssetKey(asset: LunchMoneyAsset): LunchMoneyAssetKey {
    return `${asset.institution_name}|${asset.name}|${asset.type_name}|${asset.subtype_name}|${asset.currency}`;
  }

  private async updateCachedAssets(): Promise<void> {
    const assets = await this.getAssets();
    this.cachedAssetIDs.clear();
    assets.forEach((asset) => {
      const assetKey = this.getAssetKey(asset);
      this.cachedAssetIDs.set(assetKey, asset.id);
    });
  }
}

const lunchMoneyService = new LunchMoneyService();
export default lunchMoneyService;
