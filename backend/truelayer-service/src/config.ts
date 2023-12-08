export default {
  port: process.env.PORT || 8080,
  truelayer: {
    apiOrigin: process.env.TRUELAYER_API_ORIGIN,
    clientId: process.env.TRUELAYER_CLIENT_ID,
    clientSecret: process.env.TRUELAYER_CLIENT_SECRET,
    redirectURI: process.env.TRUELAYER_REDIRECT_URI,
    tokenEncryptionSecret: process.env.TRUELAYER_TOKEN_ENCRYPTION_SECRET,
  },
  mongo: {
    url: process.env.MONGO_URL,
    username: process.env.MONGO_USERNAME,
    password: process.env.MONGO_PASSWORD,
  },
  kafka: {
    brokers: process.env.KAFKA_BROKERS.split(','),
    topic: process.env.KAFKA_TOPIC,
  },
  deployedServices: {
    lunchMoney: {
      origin: process.env.LUNCH_MONEY_SERVICE_ORIGIN || 'http://lunch-money-service:8081',
    },
  },
};
