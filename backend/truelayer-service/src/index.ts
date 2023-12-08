import express from 'express';
import mongoose from 'mongoose';
import cron from 'node-cron';
import config from './config';
import { health } from './controllers/mongo';
import {
  auth,
  getConnections,
  createConnection,
  updateConnection,
  deleteConnection,
  forceSyncTransactions,
} from './controllers/truelayer';
import truelayerService from './services/truelayer';

const app = express();
app.use(express.json());

mongoose.connect(config.mongo.url, {
  user: config.mongo.username,
  pass: config.mongo.password,
});

app.get('/', health);
app.get('/auth', auth);
app.get('/connections', getConnections);
app.post('/connections', createConnection);
app.patch('/connections/:id', updateConnection);
app.delete('/connections/:id', deleteConnection);
app.post('/sync', forceSyncTransactions);

cron.schedule('*/15 * * * *', () => {
  truelayerService.queueTransactions();
});

app.listen(config.port, () => {
  console.log(`Server started at port ${config.port}`);
});
