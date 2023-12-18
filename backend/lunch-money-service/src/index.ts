import express, { Request, Response } from 'express';
import config from './config';
import lunchMoneyService from './services/lunchMoney';

const app = express();

app.get('/', (_: Request, res: Response) => {
  res.send('OK');
});

lunchMoneyService.start();

app.listen(config.port, () => {
  console.log(`Server started at port ${config.port}`);
});
