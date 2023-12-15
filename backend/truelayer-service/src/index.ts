import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import cron from 'node-cron';
import config from './config';
import { health } from './controllers/mongo';
import {
  auth,
  redirect,
  getConnections,
  deleteConnection,
  queueTransactions,
} from './controllers/truelayer';
import truelayerService from './services/truelayer';

const app = express();
app.use(express.json());
app.use(cors());

mongoose.connect(config.mongo.url, {
  user: config.mongo.username,
  pass: config.mongo.password,
});

app.get('/', health);
app.get('/truelayer/auth', auth);
app.get('/truelayer/redirect', redirect);
app.get('/truelayer/connections', getConnections);
app.delete('/truelayer/connections/:name', deleteConnection);
app.post('/truelayer/connections/sync/:name', queueTransactions);

cron.schedule('*/15 * * * *', () => {
  truelayerService.queueTransactions();
});

cron.schedule('0 0 * * *', () => {
  truelayerService.queueTransactions(new Date(Date.now() - 30 * 24 * 3600 * 1000));
});

app.listen(config.port, () => {
  console.log(`Server started at port ${config.port}`);
});
