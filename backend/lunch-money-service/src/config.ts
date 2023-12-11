export default {
  port: process.env.PORT ?? 8081,
  lunchMoney: {
    accessToken: process.env.LUNCH_MONEY_ACCESS_TOKEN,
    apiOrigin: process.env.LUNCH_MONEY_API_ORIGIN ?? 'https://dev.lunchmoney.app',
  },
  kafka: {
    brokers: process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['kafka:9092'],
    topics: {
      transactions: process.env.KAFKA_TRANSACTIONS_TOPIC ?? 'transactions',
    },
  },
};
