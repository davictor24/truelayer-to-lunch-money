const truelayerServiceOrigin = process.env.NODE_ENV === 'development'
  ? 'http://localhost:8080' : process.env.REACT_APP_TRUELAYER_SERVICE_ORIGIN;

export default {
  truelayerService: {
    apiURL: `${truelayerServiceOrigin}/truelayer`,
  },
};
