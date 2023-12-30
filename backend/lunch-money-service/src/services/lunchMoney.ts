import { Kafka, Consumer } from 'kafkajs';
import dayjs from 'dayjs';
import config from '../config';
import logger from '../utils/logger';

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

  private cachedAssetIDs = new Map<LunchMoneyAssetKey, LunchMoneyAssetID>();

  private cachedAssetKeys = new Map<LunchMoneyAssetID, LunchMoneyAssetKey>();

  private cachedPendingCategoryID: LunchMoneyCategoryID;

  constructor() {
    const kafka = new Kafka({
      clientId: 'lunch-money-service-1',
      brokers: config.kafka.brokers,
    });
    this.consumer = kafka.consumer({ groupId: 'lunch-money-service' });
  }

  async start(): Promise<void> {
    await Promise.all([
      this.cachePendingCategoryID(),
      this.cacheAssets(),
    ]);
    this.startConsumer();
  }

  private async startConsumer(): Promise<void> {
    logger.info('Starting consumer');
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: config.kafka.topics.transactions });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        if (message.value) {
          const transactions = JSON.parse(message.value.toString());
          await this.processTransactions(transactions);
        }
      },
    });
  }

  private async processTransactions(transactions: Transactions): Promise<void> {
    try {
      const asset = this.transformTransactionSource(transactions.source);
      const assetKey = this.getKeyForAsset(asset);
      logger.info(`Processing for asset ${assetKey}`);

      let assetID = this.getAssetID(assetKey);

      if (assetID) {
        // 1. If we have the asset, update the balance if a new one was specified
        if (asset.balance) {
          logger.info(`New balance was specified for asset ${assetKey}, will update asset`);
          await this.updateAssetBalance(assetID, asset.balance);
        } else {
          logger.info(`New balance was not specified for asset ${assetKey}`);
        }
      } else {
        // 2. If we don't have the asset, create it and update the cache.
        // No need to update the balance afterwards, if the asset has a balance,
        // it would be set on creation.
        assetID = await this.createAsset(asset);
        this.cacheAsset(assetKey, assetID);
      }

      // 3. Process the transactions, if any exists
      const count = transactions.transactions.length;
      if (count > 0) {
        logger.info(`Processing ${count} transaction${count === 1 ? '' : 's'} for asset ${assetKey}`);
        const transformedTransactions = this.transformTransactions(
          transactions,
          assetID,
          asset.type_name === 'cash',
        );
        await Promise.all(transformedTransactions.map(this.insertTransactions));
      } else {
        logger.info(`No transactions to process for asset ${assetKey}`);
      }
    } catch (err) {
      logger.error(err.stack);
      // Rethrow error, so the message doesn't get committed
      throw err;
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
      balance: typeof source.balance === 'number' && !Number.isNaN(source.balance)
        ? String(source.balance)
        : undefined,
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
    const pendingTransactions: LunchMoneyTransaction[] = [];
    transactions.transactions.forEach((transaction) => {
      const transformedTransaction = this.transformTransaction(transaction, assetID);
      if (transaction.status === 'cleared') {
        clearedTransactions.push(transformedTransaction);
      } else {
        pendingTransactions.push(transformedTransaction);
      }
    });
    logger.info(
      `Transformed ${clearedTransactions.length} cleared transactions `
      + `and ${pendingTransactions.length} pending transactions `
      + `for asset ${this.getAssetKey(assetID)}`,
    );

    // A problem with the Lunch Money API is that if skip_duplicates is set to false
    // and if any of the transactions has an external_id which already exists,
    // all other transactions in the array, even new ones which don't exist yet, are ignored.
    // The only solution I can think of right now is to send each transaction independently
    // (and hope we don't hit rate limits).
    const transformedTransactions: LunchMoneyTransactions[] = [];
    clearedTransactions.forEach((transaction) => transformedTransactions.push({
      transactions: [transaction],
      apply_rules: true,
      skip_duplicates: this.shouldSkipDuplicates(transaction),
      check_for_recurring: true,
      debit_as_negative: isCashAsset,
      skip_balance_update: true,
    }));
    pendingTransactions.forEach((transaction) => transformedTransactions.push({
      transactions: [transaction],
      apply_rules: false,
      skip_duplicates: this.shouldSkipDuplicates(transaction),
      check_for_recurring: false,
      debit_as_negative: isCashAsset,
      skip_balance_update: true,
    }));
    return transformedTransactions;
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
      // Lunch Money seems to not track transaction time (only date)
      // and seems to have no concept of time zone for users.
      // dayjs uses the local timezone by default when formatting,
      // so we always send the correct date
      // (assuming this server is running in the account owner's timezone).
      date: dayjs(transaction.timestamp).format(),
      amount: transaction.amount,
      category_id: categoryID,
      payee,
      currency: transaction.currency.toLowerCase(),
      asset_id: assetID,
      status: 'cleared',
      external_id: externalID,
    };
  }

  private shouldSkipDuplicates(transaction: LunchMoneyTransaction): boolean {
    // De-duplication by external_id should be enough, if one is present
    const shouldSkip = !transaction.external_id;
    // Most sources should provide external IDs, so we want to know if any doesn't
    // and we end up skipping duplicates
    if (shouldSkip) {
      logger.warn(`Will skip duplicates for transaction for ${this.getAssetKey(transaction.asset_id)}`);
    }
    return shouldSkip;
  }

  private async getPendingCategoryID(): Promise<LunchMoneyCategoryID> {
    const getCategoriesRequestHeaders = {
      Authorization: `Bearer ${config.lunchMoney.accessToken}`,
    };
    const getCategoriesResponse = await fetch(`${config.lunchMoney.apiOrigin}/v1/categories`, {
      method: 'GET',
      headers: getCategoriesRequestHeaders,
    });
    if (getCategoriesResponse.status !== 200) {
      await this.throwFetchError(getCategoriesResponse, 'fetching categories');
    }
    logger.info(`Got status ${getCategoriesResponse.status} fetching categories`);
    const { categories } = await getCategoriesResponse.json();
    for (let i = 0; i < categories.length; i += 1) {
      if (categories[i].name === LunchMoneyService.PENDING_CATEGORY_NAME) {
        logger.info('Successfully fetched pending category');
        return categories[i].id;
      }
    }

    logger.info('Pending category does not exist, will create');
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
    if (createCategoriesResponse.status !== 200) {
      await this.throwFetchError(createCategoriesResponse, 'creating pending category');
    }
    logger.info(`Got status ${createCategoriesResponse.status} creating pending category`);
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
    if (response.status !== 200) {
      await this.throwFetchError(response, 'fetching assets');
    }
    logger.info(`Got status ${response.status} fetching assets`);
    const { assets } = await response.json();
    const count = assets.length;
    logger.info(`Fetched ${count} asset${count === 1 ? '' : 's'}`);
    return assets;
  }

  private async createAsset(asset: LunchMoneyAsset): Promise<LunchMoneyAssetID> {
    const assetKey = this.getKeyForAsset(asset);
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
    if (response.status !== 200) {
      await this.throwFetchError(response, `creating asset ${assetKey}`);
    }
    logger.info(`Got status ${response.status} creating asset ${assetKey}`);
    return (await response.json()).id;
  }

  private async updateAssetBalance(assetID: LunchMoneyAssetID, balance: string): Promise<void> {
    const assetKey = this.getAssetKey(assetID);
    const requestHeaders = {
      Authorization: `Bearer ${config.lunchMoney.accessToken}`,
      'Content-Type': 'application/json',
    };
    const response = await fetch(`${config.lunchMoney.apiOrigin}/v1/assets/${assetID}`, {
      method: 'PUT',
      headers: requestHeaders,
      body: JSON.stringify({ balance }),
    });
    if (response.status > 299) {
      await this.throwFetchError(response, `updating balance for asset ${assetKey}`);
    }
    logger.info(`Got status ${response.status} updating balance for asset ${assetKey}`);
  }

  private async insertTransactions(transactions: LunchMoneyTransactions): Promise<void> {
    const count = transactions.transactions.length;
    if (count === 0) {
      return;
    }
    const requestHeaders = {
      Authorization: `Bearer ${config.lunchMoney.accessToken}`,
      'Content-Type': 'application/json',
    };
    const response = await fetch(`${config.lunchMoney.apiOrigin}/v1/transactions`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(transactions),
    });
    if (response.status > 299) {
      await this.throwFetchError(response, 'inserting transactions');
    }
  }

  private getKeyForAsset(asset: LunchMoneyAsset): LunchMoneyAssetKey {
    return `${asset.institution_name}|${asset.name}|${asset.type_name}|${asset.subtype_name}|${asset.currency}`;
  }

  private async cachePendingCategoryID(): Promise<void> {
    const pendingCategoryID = await this.getPendingCategoryID();
    this.cachedPendingCategoryID = pendingCategoryID;
    logger.info(`Cached pending category ID ${pendingCategoryID}`);
  }

  private async cacheAssets(): Promise<void> {
    logger.info('Caching assets');
    const assets = await this.getAssets();
    const count = assets.length;
    this.clearCachedAssets();
    assets.forEach((asset) => {
      const assetKey = this.getKeyForAsset(asset);
      this.cacheAsset(assetKey, asset.id);
      logger.info(`Cached asset ${assetKey}`);
    });
    logger.info(`Cached ${count} asset${count === 1 ? '' : 's'}`);
  }

  private cacheAsset(assetKey: LunchMoneyAssetKey, assetID: LunchMoneyAssetID) {
    this.cachedAssetIDs.set(assetKey, assetID);
    this.cachedAssetKeys.set(assetID, assetKey);
  }

  private clearCachedAssets() {
    this.cachedAssetIDs.clear();
    this.cachedAssetKeys.clear();
  }

  private getAssetID(assetKey: LunchMoneyAssetKey): LunchMoneyAssetID | undefined {
    return this.cachedAssetIDs.get(assetKey);
  }

  private getAssetKey(assetID: LunchMoneyAssetID): LunchMoneyAssetKey | undefined {
    return this.cachedAssetKeys.get(assetID);
  }

  private async throwFetchError(response: Response, what: string): Promise<never> {
    throw new Error(`An error occurred when ${what}\n${await response.text()}`);
  }
}

const lunchMoneyService = new LunchMoneyService();
export default lunchMoneyService;
