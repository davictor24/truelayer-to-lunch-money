import express, { Request, Response } from 'express';
import config from './config';
import logger from './utils/logger';
import lunchMoneyService from './services/lunchMoney';

const app = express();

app.get('/', (_: Request, res: Response) => {
  res.send('OK');
});

lunchMoneyService.start();

app.listen(config.port, () => {
  logger.info(`Server started at port ${config.port}`);
});
