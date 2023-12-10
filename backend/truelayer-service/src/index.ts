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
app.get('/auth', auth);
app.get('/redirect', redirect);
app.get('/connections', getConnections);
app.delete('/connections/:name', deleteConnection);
app.post('/connections/sync/:name', queueTransactions);

cron.schedule('*/15 * * * *', () => {
  truelayerService.queueTransactions();
});

app.listen(config.port, () => {
  console.log(`Server started at port ${config.port}`);
});
