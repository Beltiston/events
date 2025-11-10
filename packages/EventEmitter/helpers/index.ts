import type { Listener, ListenerMeta, ListenerOptions } from '../types';

// Cache for compiled wildcard patterns
export const PATTERN_CACHE = new Map<string, RegExp>();

export function compilePattern(pattern: string): RegExp {
  if (PATTERN_CACHE.has(pattern)) return PATTERN_CACHE.get(pattern)!;

  const regex =
    pattern === '*' || pattern === '**'
      ? /^.*$/
      : new RegExp(
          '^' +
            pattern
              .replace(/\*\*/g, '.*')
              .replace(/\*/g, '[^.]*') +
            '$'
        );

  PATTERN_CACHE.set(pattern, regex);
  return regex;
}

// Prebuilt small arg arrays for faster emit calls
const FAST_ARGS: any[][] = [
  [],
  [undefined],
  [undefined, undefined],
  [undefined, undefined, undefined],
  [undefined, undefined, undefined, undefined],
  [undefined, undefined, undefined, undefined, undefined],
];

export function getArgs(count: number): any[] {
  if (count < FAST_ARGS.length) {
    const args = FAST_ARGS[count].slice(0, count);
    return args;
  }
  return new Array(count);
}

// Clean up listener metadata (timeouts, etc.)
export function cleanupListener(listener: Listener, metaMap?: WeakMap<Listener, ListenerMeta>): void {
  if (!metaMap) return;
  const meta = metaMap.get(listener);
  if (meta?.timeoutId) clearTimeout(meta.timeoutId);
  metaMap.delete(listener);
}

// Check if listener passes its filter
export function checkFilter(meta: ListenerMeta | undefined, args: any[]): boolean {
  return meta?.filter ? meta.filter(args) : true;
}

// Add a listener with wildcard pattern support
export function addWildcardListener(
  eventName: string,
  listener: Listener,
  wildcards: Map<string, { listener: Listener; pattern: RegExp }[]>,
  metaMap?: WeakMap<Listener, ListenerMeta>,
  options?: ListenerOptions
): number {
  const pattern = compilePattern(eventName);
  const entry = { listener, pattern };
  wildcards.set(eventName, (wildcards.get(eventName) || []).concat(entry));

  let flags = 1; // HAS_WILDCARDS

  if (options && metaMap) {
    const meta: ListenerMeta = {
      priority: options.priority ?? 0,
      times: options.times ?? -1,
      timeoutId: options.ttl && options.ttl > 0 ? setTimeout(() => {}, options.ttl) : 0,
      original: null,
      lastAccess: Date.now(),
      handle: null,
    };

    if (options.filter) {
      meta.filter = options.filter;
      flags |= 8; // HAS_FILTERS
    }

    metaMap.set(listener, meta);
  }

  return flags;
}

// Auto-cleanup for stale listeners
export function performAutoCleanup(
  events: any,
  onceEvents: any,
  metaMap: WeakMap<Listener, ListenerMeta> | undefined,
  threshold: number
) {
  const needsRemoval = new Set<{ key: string | symbol; listener?: Listener }>();
  if (!metaMap) return { events, onceEvents, needsRemoval };

  const now = Date.now();
  const check = (key: string | symbol, list: any) => {
    if (!list) return;
    const arr = typeof list === 'function' ? [list] : list;
    for (const l of arr) {
      const meta = metaMap.get(l);
      if (meta && now - meta.lastAccess > threshold) {
        needsRemoval.add({ key, listener: l });
      }
    }
  };

  for (const key in events) check(key, events[key]);
  for (const key in onceEvents) check(key, onceEvents[key]);

  return { events, onceEvents, needsRemoval };
}

// Emit to wildcards, any-listeners, and pipes
export function emitExtras(
  eventName: string | symbol,
  args: any[],
  argCount: number,
  wildcards: Map<string, { listener: Listener; pattern: RegExp }[]>,
  anyListeners: Listener[],
  pipes: any[],
  metaMap?: WeakMap<Listener, ListenerMeta>,
  flags = 0,
  propagationStopped = false
) {
  let stopped = propagationStopped;

  if ((flags & 1) && typeof eventName === 'string') {
    const name = String(eventName);
    for (const [, entries] of wildcards) {
      for (const { listener, pattern } of entries) {
        if (!pattern.test(name)) continue;
        if ((flags & 8) && !checkFilter(metaMap?.get(listener), args)) continue;
        listener(...args.slice(0, argCount));
        if (stopped) return { propagationStopped: true };
      }
    }
  }

  if (stopped) return { propagationStopped: true };

  if (flags & 4) {
    const evArgs = [eventName, ...args.slice(0, argCount)];
    for (const l of anyListeners) {
      l(...evArgs);
      if (stopped) return { propagationStopped: true };
    }
  }

  if (stopped) return { propagationStopped: true };

  if (flags & 2) {
    for (const p of pipes) {
      p.emit(eventName, ...args.slice(0, argCount));
      if (stopped) return { propagationStopped: true };
    }
  }

  return { propagationStopped: stopped };
}

// Remove all listeners for a given event
export function removeAllForEvent(
  key: string | symbol,
  events: any,
  onceEvents: any,
  wildcards: Map<string, { listener: Listener; pattern: RegExp }[]>,
  metaMap?: WeakMap<Listener, ListenerMeta>
) {
  let flags = 0;

  if (typeof key === 'string') {
    const entries = wildcards.get(key);
    if (entries) {
      entries.forEach(e => cleanupListener(e.listener, metaMap));
      wildcards.delete(key);
      if (wildcards.size === 0) flags |= 1; // clear HAS_WILDCARDS
    }
  }

  const clear = (store: any) => {
    const val = store[key];
    if (!val) return;
    (Array.isArray(val) ? val : [val]).forEach((l) => cleanupListener(l, metaMap));
    delete store[key];
  };

  clear(events);
  clear(onceEvents);

  return { events, onceEvents, wildcards, flags };
}

// Start periodic cleanup
export function startAutoCleanup(threshold: number, existing?: NodeJS.Timeout) {
  if (existing) clearInterval(existing);
  const interval = setInterval(() => {}, threshold);

  const cleanup = () => clearInterval(interval);

  if (typeof process !== 'undefined' && process.once) {
    process.once('exit', cleanup);
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  }

  return { interval, cleanup };
}
