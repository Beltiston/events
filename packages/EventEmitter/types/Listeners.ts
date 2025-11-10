export type Listener<TArgs extends any[] = any[]> = (...args: TArgs) => void;

export interface ListenerOptions {
  ttl?: number;
  times?: number;
  priority?: number;
  filter?: (args: any[]) => boolean;
}

export interface ListenerMeta {
  priority: number;
  times: number;
  timeoutId?: number | NodeJS.Timeout;
  ttl?: number;
  original: Listener | null;
  lastAccess: number;
  handle: any;
  propagate?: boolean; 
  stopped?: boolean; 
  filter?: (args: any[]) => boolean;
}
