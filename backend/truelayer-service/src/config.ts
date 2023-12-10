export default {
  port: process.env.PORT ?? 8080,
  truelayer: {
    authOrigin: process.env.TRUELAYER_AUTH_ORIGIN ?? 'https://auth.truelayer.com',
    apiOrigin: process.env.TRUELAYER_API_ORIGIN ?? 'https://api.truelayer.com',
    clientId: process.env.TRUELAYER_CLIENT_ID,
    clientSecret: process.env.TRUELAYER_CLIENT_SECRET,
    redirectURI: process.env.TRUELAYER_REDIRECT_URI,
    stateSignature: {
      secret: process.env.TRUELAYER_STATE_SIGNATURE_SECRET,
    },
    tokenEncryption: {
      secret: process.env.TRUELAYER_TOKEN_ENCRYPTION_SECRET,
      salt: process.env.TRUELAYER_TOKEN_ENCRYPTION_SALT,
    },
  },
  mongo: {
    url: process.env.MONGO_URL ?? 'mongodb://mongo:27017/connections',
    username: process.env.MONGO_USERNAME ?? 'test',
    password: process.env.MONGO_PASSWORD ?? 'test',
  },
  kafka: {
    brokers: process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['kafka:9092'],
    topics: {
      newAsset: process.env.KAFKA_NEW_ASSET_TOPIC ?? 'new_asset',
      transactions: process.env.KAFKA_TRANSACTIONS_TOPIC ?? 'transactions',
    },
  },
};
