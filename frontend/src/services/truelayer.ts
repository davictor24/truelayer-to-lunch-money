import config from '../config';

export interface Connection {
  name: string;
  last_synced: number;
  expires_at: number;
  provider: {
    name: string;
    logo_url: string;
  };
}

export class TruelayerService {
  private apiURL: string;

  constructor(apiURL: string) {
    this.apiURL = apiURL;
  }

  async getConnections(): Promise<Connection[]> {
    const response = await fetch(`${this.apiURL}/connections`);
    if (response.status !== 200) {
      throw new Error('Failed to get connections');
    }
    const res = await response.json();
    return res;
  }

  async connect(name: string): Promise<void> {
    const { origin, pathname } = window.location;
    const query = new URLSearchParams({
      name,
      url: `${origin}${pathname}`,
    });
    const response = await fetch(`${this.apiURL}/auth?${query.toString()}`);
    if (response.status !== 200) {
      throw new Error('Failed to get authentication URL');
    }
    const res = await response.json();
    const { authURL } = res;
    if (authURL) {
      window.location = res.authURL;
    } else {
      throw new Error('Invalid authentication URL');
    }
  }

  async disconnect(name: string): Promise<void> {
    const response = await fetch(
      `${this.apiURL}/connections/${this.encodeRFC3986URIComponent(name)}`,
      { method: 'DELETE' },
    );
    if (response.status !== 204) {
      throw new Error(`Failed to disconnect '${name}'`);
    }
  }

  async sync(name: string): Promise<void> {
    const response = await fetch(
      `${this.apiURL}/connections/sync/${this.encodeRFC3986URIComponent(name)}`,
      { method: 'POST' },
    );
    if (response.status !== 204) {
      throw new Error(`Failed to sync '${name}'`);
    }
  }

  async syncAll(): Promise<void> {
    const response = await fetch(
      `${this.apiURL}/connections/sync`,
      { method: 'POST' },
    );
    if (response.status !== 204) {
      throw new Error('Failed to sync all connections');
    }
  }

  private encodeRFC3986URIComponent(str: string) {
    return encodeURIComponent(str).replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  }
}

const truelayerService = new TruelayerService(config.truelayerService.apiURL);
export default truelayerService;
