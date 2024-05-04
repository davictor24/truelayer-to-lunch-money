export default {
  logLevel: process.env.LOG_LEVEL ?? 'info',
  port: process.env.PORT ?? 8080,
  truelayer: {
    authOrigin: process.env.TRUELAYER_AUTH_ORIGIN ?? (process.env.TRUELAYER_USE_SANDBOX === 'true'
      ? 'https://auth.truelayer-sandbox.com'
      : 'https://auth.truelayer.com'),
    apiOrigin: process.env.TRUELAYER_API_ORIGIN ?? (process.env.TRUELAYER_USE_SANDBOX === 'true'
      ? 'https://api.truelayer-sandbox.com'
      : 'https://api.truelayer.com'),
    clientID: process.env.TRUELAYER_CLIENT_ID,
    clientSecret: process.env.TRUELAYER_CLIENT_SECRET,
    redirectURI: process.env.TRUELAYER_REDIRECT_URI,
    providers: process.env.TRUELAYER_PROVIDERS ?? (process.env.TRUELAYER_USE_SANDBOX === 'true'
      ? 'uk-cs-mock'
      : [
        'uk-ob-all',
        'uk-oauth-all',
        'at-ob-all',
        'be-ob-all',
        'be-xs2a-all',
        'fi-ob-all',
        'fr-ob-all',
        'fr-stet-all',
        'de-ob-all',
        'de-xs2a-all',
        'ie-ob-all',
        'it-ob-all',
        'lt-ob-all',
        'lt-xs2a-all',
        'nl-ob-all',
        'nl-xs2a-all',
        'pl-ob-all',
        'pl-polishapi-all',
        'pt-ob-all',
        'es-ob-all',
        'es-xs2a-all',
        'se-ob-all',
      ].join(' ')),
    state: {
      secret: process.env.TRUELAYER_STATE_SECRET,
    },
    tokenEncryption: {
      secret: process.env.TRUELAYER_TOKEN_ENCRYPTION_SECRET,
      salt: process.env.TRUELAYER_TOKEN_ENCRYPTION_SALT,
    },
  },
  mongo: {
    url: process.env.MONGO_URL ?? 'mongodb://mongo:27017/connections',
    username: process.env.MONGO_USERNAME ?? 'user',
    password: process.env.MONGO_PASSWORD ?? 'pass',
  },
  kafka: {
    brokers: process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['kafka:9092'],
    topics: {
      transactions: process.env.KAFKA_TRANSACTIONS_TOPIC ?? 'transactions',
    },
  },
};
