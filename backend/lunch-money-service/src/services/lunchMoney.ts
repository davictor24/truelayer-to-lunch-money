import { Kafka, Consumer } from 'kafkajs';
import config from '../config';

interface Transactions {
  source: TransactionSource;
  transactions: Transaction[]
}

interface TransactionSource {
  account_id: string;
  name: string;
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
  transaction_type: string;
  transaction_category: string;
  transaction_classification: string[];
  merchant_name?: string;
}

export class LunchMoneyService {
  private consumer: Consumer;

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
    // TODO
    console.log(transactions);
  }
}

const lunchMoneyService = new LunchMoneyService();
export default lunchMoneyService;
