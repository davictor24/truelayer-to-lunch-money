import { Kafka, Consumer } from 'kafkajs';
import config from '../config';

type LunchMoneyAssetKey = string;
type LunchMoneyAssetID = number;
type LunchMoneyCategoryID = number;

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

interface LunchMoneyAsset {
  type_name: string;
  subtype_name: string;
  name: string;
  display_name?: string;
  balance?: string;
  currency: string;
  institution_name: string;
}

interface LunchMoneyTransactionsSet {
  cleared: LunchMoneyTransactions;
  pending: LunchMoneyTransactions;
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
  category_id?: LunchMoneyCategoryID;
  payee: string;
  currency: string;
  asset_id: number;
  status: 'cleared' | 'uncleared';
  external_id?: string;
}

export class LunchMoneyService {
  private static readonly PENDING_CATEGORY_NAME = 'Pending';

  private consumer: Consumer;

  // TODO: Consider using Redis
  private cachedAssetIDs = new Map<LunchMoneyAssetKey, LunchMoneyAssetID>();

  private cachedPendingCategoryID: LunchMoneyCategoryID;

  constructor() {
    const kafka = new Kafka({
      clientId: 'lunch-money-service',
      brokers: config.kafka.brokers,
    });
    this.consumer = kafka.consumer({ groupId: 'main' });
  }

  async start(): Promise<void> {
    await Promise.all([
      this.cachePendingCategoryID(),
      this.cacheAssets(),
    ]);
    this.startConsumer();
  }

  private async startConsumer(): Promise<void> {
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
      if (asset.balance) {
        // 2. Afterwards, update the balance if a new one was specified
        await this.updateAssetBalance(assetID, asset.balance);
      }
    } else {
      // 3. If we don't have the asset, create it and update the cache
      // No need to update the balance afterwards, if the asset has a balance,
      // it would have been set on creation.
      assetID = await this.createAsset(asset);
      this.cachedAssetIDs.set(assetKey, assetID);
    }

    // 4. Process the transactions, if any exists
    if (transactions.transactions.length > 0) {
      const transformedTransactionsSet = this.transformTransactions(
        transactions,
        assetID,
        asset.type_name === 'cash',
      );
      await Promise.all([
        this.insertTransactions(transformedTransactionsSet.cleared),
        this.insertTransactions(transformedTransactionsSet.pending),
      ]);
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
  ): LunchMoneyTransactionsSet {
    const clearedTransactions: LunchMoneyTransaction[] = [];
    const pendingTransactions: LunchMoneyTransaction[] = [];
    transactions.transactions.forEach((transaction) => {
      const transformedTransaction = this.transformTransaction(transaction, assetID);
      if (transaction.status === 'cleared') {
        clearedTransactions.push(transformedTransaction);
      } else {
        pendingTransactions.push(transformedTransaction);
      }
    });
    console.log(
      `Transformed ${clearedTransactions.length} cleared transactions `
      + `and ${pendingTransactions.length} pending transactions `
      + `for asset ID ${assetID}`,
    );

    return {
      cleared: {
        transactions: clearedTransactions,
        apply_rules: true,
        skip_duplicates: true,
        check_for_recurring: true,
        debit_as_negative: isCashAsset,
        // If there was a new balance specified, the asset has already been,
        // or will be updated in a different request
        skip_balance_update: transactions.source.balance !== undefined,
      },
      pending: {
        transactions: pendingTransactions,
        apply_rules: true,
        skip_duplicates: true,
        check_for_recurring: true,
        debit_as_negative: isCashAsset,
        // Don't update balance for pending transactions
        skip_balance_update: true,
      },
    };
  }

  private transformTransaction(
    transaction: Transaction,
    assetID: LunchMoneyAssetID,
  ): LunchMoneyTransaction {
    let categoryID;
    let payee = transaction.description;
    let externalID = transaction.normalised_provider_transaction_id;
    if (transaction.status === 'pending') {
      categoryID = this.cachedPendingCategoryID;
      payee = `${transaction.description} - Pending`;
      if (externalID) {
        externalID = `${externalID}-pending`;
      }
    }

    return {
      date: transaction.timestamp,
      amount: transaction.amount,
      category_id: categoryID,
      payee,
      currency: transaction.currency.toLowerCase(),
      asset_id: assetID,
      status: 'cleared',
      external_id: externalID,
    };
  }

  private async getPendingCategoryID(): Promise<LunchMoneyCategoryID> {
    const getCategoriesRequestHeaders = {
      Authorization: `Bearer ${config.lunchMoney.accessToken}`,
    };
    const getCategoriesResponse = await fetch(`${config.lunchMoney.apiOrigin}/v1/categories`, {
      method: 'GET',
      headers: getCategoriesRequestHeaders,
    });
    const { categories } = await getCategoriesResponse.json();
    for (let i = 0; i < categories.length; i += 1) {
      if (categories[i].name === LunchMoneyService.PENDING_CATEGORY_NAME) {
        return categories[i].id;
      }
    }

    // Pending category does not exist, create it
    const createCategoriesRequestHeaders = {
      Authorization: `Bearer ${config.lunchMoney.accessToken}`,
      'Content-Type': 'application/json',
    };
    const createCategoriesRequestBody = {
      name: LunchMoneyService.PENDING_CATEGORY_NAME,
      exclude_from_budget: true,
      exclude_from_totals: true,
    };
    const createCategoriesResponse = await fetch(`${config.lunchMoney.apiOrigin}/v1/categories`, {
      method: 'POST',
      headers: createCategoriesRequestHeaders,
      body: JSON.stringify(createCategoriesRequestBody),
    });
    return (await createCategoriesResponse.json()).category_id;
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
    if (transactions.transactions.length === 0) {
      return;
    }
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

  private async cachePendingCategoryID(): Promise<void> {
    this.cachedPendingCategoryID = await this.getPendingCategoryID();
  }

  private async cacheAssets(): Promise<void> {
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
