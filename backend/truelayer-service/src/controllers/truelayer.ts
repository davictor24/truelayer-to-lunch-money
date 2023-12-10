import { Request, Response } from 'express';
import truelayerService from '../services/truelayer';

interface ConnectionResponse {
  name: string;
  lastSynced: number;
  expiresAt: number;
  provider: {
    name: string;
    logoURL: string;
  };
}

export async function auth(req: Request, res: Response) {
  const { name, state } = req.query;
  if (typeof name !== 'string') {
    res.status(400).send('Invalid connection name');
  } else if (!(await truelayerService.isNewConnectionName(name))) {
    res.status(400).send('Connection name should be unique');
  } else if (typeof state !== 'string') {
    res.status(400).send('Invalid state parameter');
  } else {
    res.json({ authURL: truelayerService.getAuthURL(state) });
  }
}

export async function getConnections(_: Request, res: Response) {
  const connections = await truelayerService.getConnections();
  const connectionResponse = connections.map<ConnectionResponse>(
    (connection) => ({
      name: connection.connection_name,
      lastSynced: connection.last_synced.getTime(),
      expiresAt: connection.refresh_token.expires_in.getTime(),
      provider: {
        name: connection.metadata.provider.display_name,
        logoURL: connection.metadata.provider.logo_uri,
      },
    }),
  );
  res.json(connectionResponse);
}

export async function createConnection(req: Request, res: Response) {
  const { name } = req.params;
  const { code } = req.body;
  const connection = await truelayerService.createConnection(name, code);
  res.status(201).send(connection);
}

export async function deleteConnection(req: Request, res: Response) {
  const { name } = req.params;
  await truelayerService.deleteConnection(name);
  res.status(204).send();
}

export async function queueTransactions(req: Request, res: Response) {
  const { name } = req.params;
  await truelayerService.queueTransactions(name);
  res.status(204).send();
}
