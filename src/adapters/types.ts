export interface Snapshot {
  externalId: string;
  title: string;
  url: string;
  priceCents: number;
  available: boolean;
  storeId?: string;
  quantity?: number;
}

export interface Adapter<Cfg = unknown> {
  key: string;
  fetch(cfg: Cfg): Promise<Snapshot[]>;
}

export interface SourceConfig {
  id: number;
  adapterKey: string;
  enabled: boolean;
  config: Record<string, unknown>;
}
