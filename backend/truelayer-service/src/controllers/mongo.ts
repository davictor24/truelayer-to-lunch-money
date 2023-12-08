import { Request, Response } from 'express';
import mongoose from 'mongoose';

export function health(_: Request, res: Response) {
  if (mongoose.connection.readyState === 1) {
    res.send('OK');
  }
}
