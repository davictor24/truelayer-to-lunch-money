// TODO: Remove the eslint-disable line below
/* eslint-disable @typescript-eslint/no-unused-vars */
import mongoose from 'mongoose';
import config from '../config';

export class TruelayerService {
  getAuthURL(): string {
    return '';
  }

  getConnections() { }

  createConnection() { }

  updateConnection() { }

  deleteConnection() { }

  private getTransactions() { }

  queueTransactions() { }

  forceSyncTransactions() { }
}

const truelayerService = new TruelayerService();
export default truelayerService;
