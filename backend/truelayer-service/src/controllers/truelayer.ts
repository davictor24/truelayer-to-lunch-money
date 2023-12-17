import { Request, Response } from 'express';
import truelayerService from '../services/truelayer';

interface ConnectionResponse {
  name: string;
  last_synced: number;
  expires_at: number;
  provider: {
    name: string;
    logo_url: string;
  };
}

export async function auth(req: Request, res: Response) {
  const { name, url } = req.query;
  if (typeof name !== 'string' || !name) {
    res.status(400).send('Invalid connection name');
  } else if (typeof url !== 'string') {
    res.status(400).send('Invalid URL parameter');
  } else {
    res.json({ authURL: truelayerService.getAuthURL(name, url) });
  }
}

export async function redirect(req: Request, res: Response) {
  const { code, state } = req.query;
  if (typeof code !== 'string') {
    res.status(400).send('Invalid code parameter');
  } else if (typeof state !== 'string') {
    res.status(400).send('Invalid state parameter');
  } else {
    try {
      const decodedState = truelayerService.decodeState(state);
      await truelayerService.createConnection(decodedState.name, code);
      res.set('Location', decodedState.url);
      res.status(301).send();
    } catch (err) {
      res.status(400).send(err.message);
    }
  }
}

export async function getConnections(_: Request, res: Response) {
  const connections = await truelayerService.getConnections();
  const connectionResponse = connections.map<ConnectionResponse>(
    (connection) => ({
      name: connection.connection_name,
      last_synced: connection.last_synced.getTime(),
      expires_at: connection.refresh_token.expires_in.getTime(),
      provider: {
        name: connection.metadata.provider.display_name,
        logo_url: connection.metadata.provider.logo_uri,
      },
    }),
  );
  res.json(connectionResponse);
}

export async function deleteConnection(req: Request, res: Response) {
  const { name } = req.params;
  await truelayerService.deleteConnection(name);
  res.status(204).send();
}

export async function queueTransactionsForConnectionNameWayBack(req: Request, res: Response) {
  const { name } = req.params;
  await truelayerService.queueTransactionsForConnectionNameWayBack(name);
  res.status(204).send();
}
