import express, { Request, Response } from 'express';
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
  queueTransactionsForConnectionNameWayBack,
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
app.post('/truelayer/connections/sync/:name', queueTransactionsForConnectionNameWayBack);

app.use((err: Error, _: Request, res: Response) => {
  console.error(err.stack);
  res.status(500).send('An error occurred');
});

const queueTransactions = (wayBack = false) => {
  try {
    if (wayBack) truelayerService.queueTransactionsWayBack();
    else truelayerService.queueTransactions();
  } catch (err) {
    console.error(err.stack);
  }
};

// Runs every 15 minutes, apart from 12am every day
cron.schedule('*/15 1-23 * * *', () => {
  queueTransactions();
});
cron.schedule('15-45/15 0 * * *', () => {
  queueTransactions();
});

// Runs 12am every day to get transactions that might have cleared
// (or transactions that might have been missed for some reason)
cron.schedule('0 0 * * *', () => {
  queueTransactions(true);
});

app.listen(config.port, () => {
  console.log(`Server started at port ${config.port}`);
});
