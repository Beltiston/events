import type { 
  EventKey, 
  EventMap, 
  EventArgs, 
  Listener, 
  ListenerMeta, 
  ListenerOptions, 
  EventListener, 
  EventEmitterOptions 
} from './types';
import { 
  getArgs, 
  compilePattern, 
  PATTERN_CACHE,
  cleanupListener,
  checkFilter,
  addWildcardListener,
  emitExtras,
  removeAllForEvent,
  startAutoCleanup
} from './helpers';

/**
 * A high-performance, feature-rich EventEmitter implementation with advanced capabilities
 * 
 * @template T - Event map type defining event names and their handler signatures
 * @example
 * ```typescript
 * interface MyEvents {
 *   'data': (data: string) => void;
 *   'error': (error: Error) => void;
 * }
 * 
 * const emitter = new EventEmitter<MyEvents>();
 * emitter.on('data', (data) => console.log(data));
 * ```
 */
export class EventEmitter<T extends EventMap> {
  // PRIVATE PROPERTIES
  private events: any = {};
  private onceEvents: any = {};
  private wildcards: Map<string, {listener: Listener, pattern: RegExp}[]> = new Map();
  private anyListeners: Listener[] = [];
  private pipes: EventEmitter<any>[] = [];
  private metadata?: WeakMap<Listener, ListenerMeta>;
  private maxListeners = 10;
  private cleanupInterval?: NodeJS.Timeout;
  private cleanupThreshold = 300000;
  private propagationStopped = false;

  private flags = 0;
  private static readonly HAS_WILDCARDS = 1;
  private static readonly HAS_PIPES = 2;
  private static readonly HAS_ANY = 4;
  private static readonly HAS_FILTERS = 8;

  /**
   * Creates a new EventEmitter instance
   * 
   * @param opts - Configuration options
   * @param opts.autoCleanup - Enable automatic cleanup of stale listeners
   * @param opts.autoCleanupThreshold - Time in ms after which listeners are considered stale
   * @example
   * ```typescript
   * // With auto cleanup
   * const emitter = new EventEmitter({ 
   *   autoCleanup: true, 
   *   autoCleanupThreshold: 300000 // 5 minutes 
   * });
   * // 5 minutes is the default time in which listeners are considered stale
   * ```
   */
  constructor(opts?: EventEmitterOptions) {
    if (opts?.autoCleanupThreshold) this.cleanupThreshold = opts.autoCleanupThreshold;
    if (opts?.autoCleanup || opts?.autoCleanupThreshold) {
      const { interval } = startAutoCleanup(this.cleanupThreshold, this.cleanupInterval);
      this.cleanupInterval = interval;
    }
  }

  /**
   * Completely destroys the emitter, removing all listeners and cleaning up resources
   * 
   * @example
   * ```typescript
   * emitter.destroy();
   * ```
   */
  destroy(): void {
    this.removeAllListeners();
    this.cleanupInterval && clearInterval(this.cleanupInterval);
    this.metadata = undefined;
  }

  // PUBLIC API METHODS

  /**
   * Adds a listener for the specified event
   * 
   * @param eventName - Name of the event to listen for
   * @param listener - Function to be called when event is emitted
   * @param options - Additional listener options
   * @returns `this` for chaining
   * @alias - emitter.on(eventName, listener, options)
   * @example
   * ```typescript
   * emitter.addListener('data', (data) => console.log(data));
   * emitter.addListener('user.*', (data) => console.log(data), {
   *   priority: 10,
   *   times: 5 // Only handle 5 times
   * });
   * ```
   */
  addListener<K extends EventKey<T>>(eventName: K, listener: EventListener<T, K>, options?: ListenerOptions): this {
    const key = eventName as string | symbol;
    const fn = listener as any;
    
    if (typeof key === 'string' && (key.includes('*') || key.includes('?'))) {
      const flags = addWildcardListener(
        key, 
        fn, 
        this.wildcards, 
        this.metadata, 
        options
      );
      this.flags |= flags;
      return this;
    }

    if (eventName === '*') {
      this.anyListeners[this.anyListeners.length] = listener as Listener;
      this.flags |= EventEmitter.HAS_ANY;
      return this;
    }

    if (!options) {
      const current = this.events[key];
      if (!current) {
        this.events[key] = fn;
      } else if (typeof current === 'function') {
        this.events[key] = [current, fn];
      } else {
        current[current.length] = fn;
        if (current.length > this.maxListeners && (current.length & (current.length - 1)) === 0) {
          console.warn(`[EventEmitter] Possible memory leak: ${current.length} listeners for "${String(key)}". Max: ${this.getMaxListeners()}`);
        }
      }
      return this;
    }

    if (!this.metadata) this.metadata = new WeakMap();
    
    const priority = options.priority ?? 0;
    const times = options.times ?? -1;
    let finalListener = fn;
    let originalListener: Listener | null = null;

    if (times > 0) {
      originalListener = fn;
      const self = this;
      finalListener = function(this: any, ...args: any[]): any {
        const meta = self.metadata!.get(finalListener);
        if (meta && --meta.times === 0) self.removeListener(eventName, finalListener as any);
        return originalListener!.apply(this, args);
      } as Listener;
    }
    
    const meta: ListenerMeta = {
      priority,
      times,
      timeoutId: options.ttl && options.ttl > 0 ? setTimeout(() => this.removeListener(eventName, finalListener as any), options.ttl) : 0,
      original: originalListener,
      lastAccess: Date.now(),
      handle: null
    };

    if (options.filter) {
      meta.filter = options.filter;
      this.flags |= EventEmitter.HAS_FILTERS;
    }

    this.metadata.set(finalListener, meta);

    const current = this.events[key];
    
    if (priority === 0) {
      if (!current) {
        this.events[key] = finalListener;
      } else if (typeof current === 'function') {
        this.events[key] = [current, finalListener];
      } else {
        current[current.length] = finalListener;
      }
    } else {
      let arr: Listener[];
      if (!current) {
        arr = [finalListener];
        this.events[key] = arr;
      } else if (typeof current === 'function') {
        arr = [current];
        this.events[key] = arr;
      } else {
        arr = current;
      }

      let inserted = false;
      for (let i = 0, len = arr.length; i < len; i++) {
        const existingMeta = this.metadata.get(arr[i]);
        if (priority > (existingMeta?.priority ?? 0)) {
          arr.splice(i, 0, finalListener);
          inserted = true;
          break;
        }
      }
      if (!inserted) arr[arr.length] = finalListener;
    }
    
    return this;
  }

  /**
   * Alias for `addListener`
   * 
   * @param eventName - Name of the event to listen for
   * @param listener - Function to be called when event is emitted
   * @param options - Additional listener options
   * @returns `this` for chaining
   */
  on<K extends EventKey<T>>(eventName: K, listener: EventListener<T, K>, options?: ListenerOptions): this {
    return this.addListener(eventName, listener, options);
  }

  /**
   * Updates an event listener for the given event.
   * Removes existing listeners (optionally filtered by a predicate) 
   * and adds a new one.
   *
   * @template K
   * @param eventName - The name of the event.
   * @param listener - The new listener to add.
   * @param options - Optional listener options.
   * @param predicate - Optional function to match which existing listeners to remove.
   * @returns this for chaining
   *
   * @example
   * ```typescript
   * const newListener = () => console.log('i like eggs');
   * emitter.update("data", newListener, undefined, oldListener => oldListener.name === "oldHandler");
 */
  update<K extends EventKey<T>>(eventName: K, listener: EventListener<T, K>, options?: ListenerOptions, predicate?: (existing: EventListener<T, K>) => boolean): this {
   if (predicate) {
     const listeners = this.listeners(eventName);
     listeners.forEach(l => { if (predicate(l)) this.removeListener(eventName, l); });
   } else {
     this.removeListener(eventName);
   }
   return this.addListener(eventName, listener, options);
 }


  /**
   * Adds a one-time listener for the event
   * 
   * @param eventName - Name of the event to listen for
   * @param listener - Function to be called when event is emitted (only once)
   * @param options - Additional listener options
   * @returns `this` for chaining
   * @example
   * ```typescript
   * emitter.once('connection', (conn) => {
   *   console.log('First connection established');
   * });
   * ```
   */
  once<K extends EventKey<T>>(eventName: K, listener: EventListener<T, K>, options?: ListenerOptions): this {
    const key = eventName as string | symbol;
    const fn = listener as any;
    
    // Fast path: no options, no wildcards
    if (!options && typeof key !== 'string') {
      const current = this.onceEvents[key];
      if (!current) {
        this.onceEvents[key] = fn;
      } else if (typeof current === 'function') {
        this.onceEvents[key] = [current, fn];
      } else {
        current[current.length] = fn;
      }
      return this;
    }
    
    if (!this.metadata) this.metadata = new WeakMap();
    
    const priority = options?.priority ?? 0;
    const meta: ListenerMeta = {
      priority,
      times: -1,
      timeoutId: options?.ttl && options.ttl > 0 ? setTimeout(() => this.removeListener(eventName, listener), options.ttl) : 0,
      original: null,
      lastAccess: Date.now(),
      handle: null
    };

    if (options?.filter) {
      meta.filter = options.filter;
      this.flags |= EventEmitter.HAS_FILTERS;
    }

    this.metadata.set(fn, meta);
    
    const current = this.onceEvents[key];
    
    if (priority === 0) {
      if (!current) {
        this.onceEvents[key] = fn;
      } else if (typeof current === 'function') {
        this.onceEvents[key] = [current, fn];
      } else {
        current[current.length] = fn;
      }
    } else {
      let arr: Listener[];
      if (!current) {
        arr = [fn];
        this.onceEvents[key] = arr;
      } else if (typeof current === 'function') {
        arr = [current];
        this.onceEvents[key] = arr;
      } else {
        arr = current;
      }

      let inserted = false;
      for (let i = 0, len = arr.length; i < len; i++) {
        const existingMeta = this.metadata.get(arr[i]);
        if (priority > (existingMeta?.priority ?? 0)) {
          arr.splice(i, 0, fn);
          inserted = true;
          break;
        }
      }
      if (!inserted) arr[arr.length] = fn;
    }
    
    return this;
  }

  /**
   * Removes the specified listener for the specified event
   * 
   * @param eventName - Name of the event to remove listener from
   * @param listener - The listener function to remove
   * @returns `this` for chaining
   * @example
   * ```typescript
   * const handler = (data) => console.log(data);
   * emitter.on('data', handler);
   * emitter.removeListener('data', handler);
   * ```
   */
  removeListener<K extends EventKey<T>>(eventName?: K, listener?: EventListener<T, K>): this {
    if (!eventName) {
      this.removeAllListeners();
      return this;
    }

    const key = eventName as string | symbol;
    
    if (!listener) {
      const result = removeAllForEvent(
        key,
        this.events,
        this.onceEvents,
        this.wildcards,
        this.metadata
      );
      this.events = result.events;
      this.onceEvents = result.onceEvents;
      this.wildcards = result.wildcards;
      this.flags &= ~result.flags;
      return this;
    }

    const fn = listener as any;
  
    if (typeof key === 'string' && this.wildcards.has(key)) {
      const entries = this.wildcards.get(key)!;
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].listener === fn) {
          cleanupListener(fn, this.metadata);
          entries.splice(i, 1);
          if (entries.length === 0) {
            this.wildcards.delete(key);
            if (this.wildcards.size === 0) this.flags &= ~EventEmitter.HAS_WILDCARDS;
          }
          return this;
        }
      }
    }
    
    // Remove from regular events
    let l = this.events[key];
    if (l) {
      if (l === fn) {
        cleanupListener(fn, this.metadata);
        delete this.events[key];
      } else if (typeof l !== 'function') {
        const idx = l.indexOf(fn);
        if (idx > -1) {
          cleanupListener(fn, this.metadata);
          l.splice(idx, 1);
          if (l.length === 1) this.events[key] = l[0];
          else if (l.length === 0) delete this.events[key];
        } else if (this.metadata) {
          // Check for wrapped listeners
          for (let i = l.length - 1; i >= 0; i--) {
            const meta = this.metadata.get(l[i]);
            if (meta?.original === fn) {
              cleanupListener(l[i], this.metadata);
              l.splice(i, 1);
              if (l.length === 1) this.events[key] = l[0];
              else if (l.length === 0) delete this.events[key];
              break;
            }
          }
        }
      }
    }
    
    l = this.onceEvents[key];
    if (l) {
      if (l === fn) {
        cleanupListener(fn, this.metadata);
        delete this.onceEvents[key];
      } else if (typeof l !== 'function') {
        const idx = l.indexOf(fn);
        if (idx > -1) {
          cleanupListener(fn, this.metadata);
          l.splice(idx, 1);
          if (l.length === 1) this.onceEvents[key] = l[0];
          else if (l.length === 0) delete this.onceEvents[key];
        }
      }
    }
    
    return this;
  }

  /**
   * Alias for `removeListener`
   * 
   * @param eventName - Name of the event to remove listener from
   * @param listener - The listener function to remove
   * @returns `this` for chaining
   */
  off<K extends EventKey<T>>(eventName?: K, listener?: EventListener<T, K>): this {
    return this.removeListener(eventName, listener);
  }

  /**
   * Removes all listeners, or those of the specified event
   * 
   * @param eventName - Optional event name to remove all listeners for
   * @returns `this` for chaining
   * @example
   * ```typescript
   * // Remove all listeners for 'data' event
   * emitter.removeAllListeners('data');
   * 
   * // Remove all listeners for all events
   * emitter.removeAllListeners();
   * ```
   */
  removeAllListeners<K extends EventKey<T>>(eventName?: K): this {
    if (eventName) {
      const result = removeAllForEvent(
        eventName as string | symbol,
        this.events,
        this.onceEvents,
        this.wildcards,
        this.metadata
      );
      this.events = result.events;
      this.onceEvents = result.onceEvents;
      this.wildcards = result.wildcards;
      this.flags &= ~result.flags;
    } else {
      this.wildcards.clear();
      this.anyListeners = [];
      this.pipes = [];
      this.flags = 0;
      this.events = {};
      this.onceEvents = {};
      this.metadata = undefined;
    }
    return this;
  }

  /**
   * Synchronously calls each of the listeners registered for the event
   * 
   * @param eventName - The name of the event to emit
   * @param a - First argument to pass to listeners
   * @param b - Second argument to pass to listeners  
   * @param c - Third argument to pass to listeners
   * @param d - Fourth argument to pass to listeners
   * @param e - Fifth argument to pass to listeners
   * starting from the Sixth argument, uses a slower path (having >6 arguments is uncommon) otherwise uses a fast path.
   * @returns `true` if event had listeners, `false` otherwise
   * @example
   * ```typescript
   * emitter.emit('data', 'hello world');
   * emitter.emit('user.created', user, timestamp);
   * ```
   */
  emit<K extends EventKey<T>>(eventName: K, a?: any, b?: any, c?: any, d?: any, e?: any): boolean {
    const key = eventName as string | symbol;
    const l = this.events[key];
  
    if (typeof l === 'function') {
      const al = arguments.length - 1;
      
      // Fast path: check filters if needed
      if ((this.flags & EventEmitter.HAS_FILTERS) && !checkFilter(this.metadata?.get(l), [a, b, c, d, e].slice(0, al))) {
        // Filter rejected, skip this listener but continue with others
      } else {
        switch (al) {
          case 0: l(); break;
          case 1: l(a); break;
          case 2: l(a, b); break;
          case 3: l(a, b, c); break;
          case 4: l(a, b, c, d); break;
          case 5: l(a, b, c, d, e); break;
          default: {
            const args = getArgs(al);
            for (let i = 0; i < al; i++) args[i] = arguments[i + 1];
            l(...args);
          }
        }
      }
      
      if (this.propagationStopped) return true;

      const ol = this.onceEvents[key];
      if (ol) {
        if (typeof ol === 'function') {
          if (!(this.flags & EventEmitter.HAS_FILTERS) || checkFilter(this.metadata?.get(ol), [a, b, c, d, e].slice(0, al))) {
            cleanupListener(ol, this.metadata);
            delete this.onceEvents[key];
            switch (al) {
              case 0: ol(); break;
              case 1: ol(a); break;
              case 2: ol(a, b); break;
              case 3: ol(a, b, c); break;
              case 4: ol(a, b, c, d); break;
              case 5: ol(a, b, c, d, e); break;
              default: {
                const args = getArgs(al);
                for (let i = 0; i < al; i++) args[i] = arguments[i + 1];
                ol(...args);
              }
            }
          }
        } else {
          const n = ol.length;
          for (let i = 0; i < n; i++) cleanupListener(ol[i], this.metadata);
          delete this.onceEvents[key];
          switch (al) {
            case 0: for (let i = 0; i < n; i++) ol[i](); break;
            case 1: for (let i = 0; i < n; i++) ol[i](a); break;
            case 2: for (let i = 0; i < n; i++) ol[i](a, b); break;
            case 3: for (let i = 0; i < n; i++) ol[i](a, b, c); break;
            case 4: for (let i = 0; i < n; i++) ol[i](a, b, c, d); break;
            case 5: for (let i = 0; i < n; i++) ol[i](a, b, c, d, e); break;
            default: {
              const args = getArgs(al);
              for (let j = 0; j < al; j++) args[j] = arguments[j + 1];
              for (let i = 0; i < n; i++) ol[i](...args);
            }
          }
        }
      }

      if (this.propagationStopped) return true;

      if (this.flags) {
        const args = [a, b, c, d, e].slice(0, al);
        const result = emitExtras(
          eventName,
          args,
          al,
          this.wildcards,
          this.anyListeners,
          this.pipes,
          this.metadata,
          this.flags,
          this.propagationStopped
        );
        this.propagationStopped = result.propagationStopped;
      }
      
      return true;
    }
    
    const ol = this.onceEvents[key];
    const w = this.anyListeners;
    const p = this.pipes;
    
    if (!l && !ol && !w.length && !p.length) return false;
    
    const al = arguments.length - 1;

    if (l) {
      const n = l.length;
      switch (al) {
        case 0: for (let i = 0; i < n; i++) l[i](); break;
        case 1: for (let i = 0; i < n; i++) l[i](a); break;
        case 2: for (let i = 0; i < n; i++) l[i](a, b); break;
        case 3: for (let i = 0; i < n; i++) l[i](a, b, c); break;
        case 4: for (let i = 0; i < n; i++) l[i](a, b, c, d); break;
        case 5: for (let i = 0; i < n; i++) l[i](a, b, c, d, e); break;
        default: {
          const args = getArgs(al);
          for (let j = 0; j < al; j++) args[j] = arguments[j + 1];
          for (let i = 0; i < n; i++) l[i](...args);
        }
      }
    }
    
    if (ol) {
      if (typeof ol === 'function') {
        cleanupListener(ol, this.metadata);
        delete this.onceEvents[key];
        switch (al) {
          case 0: ol(); break;
          case 1: ol(a); break;
          case 2: ol(a, b); break;
          case 3: ol(a, b, c); break;
          case 4: ol(a, b, c, d); break;
          case 5: ol(a, b, c, d, e); break;
          default: {
            const args = getArgs(al);
            for (let i = 0; i < al; i++) args[i] = arguments[i + 1];
            ol(...args);
          }
        }
      } else {
        const n = ol.length;
        for (let i = 0; i < n; i++) cleanupListener(ol[i], this.metadata);
        delete this.onceEvents[key];
        switch (al) {
          case 0: for (let i = 0; i < n; i++) ol[i](); break;
          case 1: for (let i = 0; i < n; i++) ol[i](a); break;
          case 2: for (let i = 0; i < n; i++) ol[i](a, b); break;
          case 3: for (let i = 0; i < n; i++) ol[i](a, b, c); break;
          case 4: for (let i = 0; i < n; i++) ol[i](a, b, c, d); break;
          case 5: for (let i = 0; i < n; i++) ol[i](a, b, c, d, e); break;
          default: {
            const args = getArgs(al);
            for (let j = 0; j < al; j++) args[j] = arguments[j + 1];
            for (let i = 0; i < n; i++) ol[i](...args);
          }
        }
      }
    }
    
    if (this.propagationStopped) return true;

    if (this.flags) {
      const args = [a, b, c, d, e].slice(0, al);
      const result = emitExtras(
        eventName,
        args,
        al,
        this.wildcards,
        this.anyListeners,
        this.pipes,
        this.metadata,
        this.flags,
        this.propagationStopped
      );
      this.propagationStopped = result.propagationStopped;
    }
    return true;
  }

  /**
   * Asynchronously calls each of the listeners and waits for all promises to resolve
   * 
   * @param eventName - The name of the event to emit
   * @param args - Arguments to pass to listeners
   * @returns Promise that resolves to `true` if event had listeners, `false` otherwise
   * @example
   * ```typescript
   * await emitter.emitAsync('data', 'hello world');
   * ```
   */
  async emitAsync<K extends EventKey<T>>(eventName: K, ...args: EventArgs<T, K>): Promise<boolean> {
    const listeners = this.listeners(eventName);
    
    if (listeners.length === 0 && !this.anyListeners.length && !this.pipes.length && this.wildcards.size === 0) return false;
    
    const promises: Promise<unknown>[] = [];
    
    for (const listener of listeners) {
      try {
        const result = (listener as Function)(...args);
        if (result && typeof result.then === 'function') promises.push(result);
      } catch (error) {
        console.error('Listener error in emitAsync:', error);
      }
    }

    if (promises.length > 0) await Promise.allSettled(promises);

    return true;
  }

  /**
   * Stops propagation of the current event to subsequent listeners
   * 
   * @example
   * ```typescript
   * emitter.on('data', (data) => {
   *   if (data === 'stop') {
   *     emitter.stopPropagation();
   *   }
   * });
   * ```
   */
  stopPropagation(): void { this.propagationStopped = true; }

  /**
   * Pipes all events from this emitter to another emitter
   * 
   * @param target - The target emitter to pipe events to
   * @returns `this` for chaining
   * @example
   * ```typescript
   * const emitter1 = new EventEmitter();
   * const emitter2 = new EventEmitter();
   * emitter1.pipe(emitter2);
   * // All events emitted from emitter1 will also be emitted from emitter2
   * ```
   */
  pipe(target: EventEmitter<any>): this { this.pipes.push(target); this.flags |= EventEmitter.HAS_PIPES; return this; }

  /**
   * Removes piping to the specified target or all targets
   * 
   * @param target - Optional specific target to unpipe
   * @returns `this` for chaining
   */
  unpipe(target?: EventEmitter<any>): this {
    if (!target) { 
      this.pipes = []; 
      this.flags &= ~EventEmitter.HAS_PIPES; 
    } else {
      const i = this.pipes.indexOf(target);
      if (i > -1) {
        this.pipes.splice(i, 1);
        if (this.pipes.length === 0) this.flags &= ~EventEmitter.HAS_PIPES;
      }
    }
    return this;
  }

  /**
   * Returns the number of listeners for the specified event
   * 
   * @param eventName - Optional event name to count listeners for
   * @returns Number of listeners
   * @example
   * ```typescript
   * // Count listeners for 'data' event
   * const count = emitter.listenerCount('data');
   * 
   * // Count all listeners
   * const total = emitter.listenerCount();
   * ```
   */
  listenerCount<K extends EventKey<T>>(eventName?: K): number {
    if (!eventName) {
      let total = this.anyListeners.length;
      this.wildcards.forEach(entries => total += entries.length);
      Object.values(this.events).forEach((v: any) => total += typeof v === 'function' ? 1 : v.length);
      Object.values(this.onceEvents).forEach((v: any) => total += typeof v === 'function' ? 1 : v.length);
      return total;
    }

    const key = eventName as string | symbol;
    let total = 0;
    
    [this.events, this.onceEvents].forEach(store => {
      const listeners = store[key];
      if (listeners) total += typeof listeners === 'function' ? 1 : listeners.length;
    });

    if (typeof key === 'string') {
      this.wildcards.forEach((entries, pattern) => {
        const regex = PATTERN_CACHE.get(pattern) || compilePattern(pattern);
        if (regex.test(key)) total += entries.length;
      });
    }

    return total;
  }

  /**
   * Returns an array of all event names that have listeners
   * 
   * @returns Object containing arrays of regular, once, and wildcard event names
   * @example
   * ```typescript
   * console.log(emitter.eventNames());   // { regular: ['data', 'error'], once: ['connect'], wildcards: ['user.*'] }
   * ```
   */
  eventNames(): { regular: EventKey<T>[], once: EventKey<T>[], wildcards: EventKey<T>[] } {
    const regular = new Set<EventKey<T>>();
    const once = new Set<EventKey<T>>();
    const wildcards = new Set<EventKey<T>>();

    for (const i in this.events) this.events[i] && regular.add(i as EventKey<T>);
    for (const i in this.onceEvents) this.onceEvents[i] && once.add(i as EventKey<T>);
    for (const i of this.wildcards.keys()) wildcards.add(i as EventKey<T>);

    return { regular: [...regular], once: [...once], wildcards: [...wildcards] };
  }

  /**
   * Returns a copy of the array of listeners for the specified event
   * 
   * @param eventName - The event name to get listeners for
   * @returns Array of listener functions
   * @example
   * ```typescript
   * const handler1 = (data: string) => console.log('Handler 1:', data);
   * const handler2 = (data: string) => console.log('Handler 2:', data);
   * 
   * emitter.on('data', handler1);
   * emitter.once('data', handler2, { priority: 10 });
   * 
   * const listeners = emitter.listeners('data');
   * console.log(listeners);            // Returns: [handler1, wrappedHandler2]
   * 
   * // Where wrappedHandler2 is the internal wrapper function that auto-removes itself
   */
  listeners<K extends EventKey<T>>(eventName: K): EventListener<T, K>[] {
    const key = eventName as string | symbol;
    const result: EventListener<T, K>[] = [];

    const addListeners = (listeners: any): void => {
      if (!listeners) return;
      if (typeof listeners === 'function') {
        result.push(listeners as EventListener<T, K>);
      } else {
        listeners.forEach((listener: any) => result.push(listener as EventListener<T, K>));
      }
    };

    addListeners(this.events[key]);
    addListeners(this.onceEvents[key]);

    if (typeof key === 'string') {
      this.wildcards.forEach((entries, pattern) => {
        const regex = PATTERN_CACHE.get(pattern) || compilePattern(pattern);
        if (regex.test(key)) {
          entries.forEach(entry => result.push(entry.listener as EventListener<T, K>));
        }
      });
    }

    return result;
  }

  /**
   * Returns a copy of the array of listeners for the specified event,
   * including any wrapper functions but returning the original listeners
   * 
   * @param eventName - The event name to get raw listeners for
   * @returns Array of original listener functions
   * @example
   * ```typescript
   * const handler1 = (data: string) => console.log('Handler 1:', data);
   * const handler2 = (data: string) => console.log('Handler 2:', data);
   * 
   * emitter.on('data', handler1);
   * emitter.once('data', handler2, { priority: 10 });
   * 
   * const rawListeners = emitter.rawListeners('data');
   * console.log(rawListeners);            // Returns: [handler1, handler2]
   * 
   * // Where handler2 is the original function, not the wrapper
   */
  rawListeners<K extends EventKey<T>>(eventName: K): EventListener<T, K>[] {
    const key = eventName as string | symbol;
    const result: EventListener<T, K>[] = [];

    const addRaw = (listeners: any): void => {
      if (!listeners) return;
      if (typeof listeners === 'function') {
        const meta = this.metadata?.get(listeners);
        result.push((meta?.original || listeners) as EventListener<T, K>);
      } else {
        listeners.forEach((listener: any) => {
          const meta = this.metadata?.get(listener);
          result.push((meta?.original || listener) as EventListener<T, K>);
        });
      }
    };

    addRaw(this.events[key]);
    addRaw(this.onceEvents[key]);

    if (typeof key === 'string') {
      this.wildcards.forEach((entries, pattern) => {
        const regex = PATTERN_CACHE.get(pattern) || compilePattern(pattern);
        if (regex.test(key)) {
          entries.forEach(entry => result.push(entry.listener as EventListener<T, K>));
        }
      });
    }

    return result;
  }

  /**
   * Sets the maximum number of listeners that can be added for a single event
   * 
   * @param n - The maximum number of listeners
   * @returns `this` for chaining
   */
  setMaxListeners(n: number): this { this.maxListeners = n; return this; }

  /**
   * Returns the current maximum number of listeners that can be added for a single event
   * 
   * @returns The maximum number of listeners
   */
  getMaxListeners(): number { return this.maxListeners; }

  /**
   * Adds a listener to the beginning of the listeners array
   * 
   * @param eventName - Name of the event to listen for
   * @param listener - Function to be called when event is emitted
   * @param options - Additional listener options
   * @returns `this` for chaining
   * @example
   * ```typescript
   * // This listener will execute before others
   * emitter.prependListener('data', (data) => {
   *   console.log('This runs first!');
   * });
   * ```
   */
  prependListener<K extends EventKey<T>>(eventName: K, listener: EventListener<T, K>, options?: ListenerOptions): this {
    const key = eventName as string | symbol;
    const fn = listener as any;
    
    if (typeof key === 'string' && (key.includes('*') || key.includes('?'))) {
      // For wildcards, we'll handle priority through options
      return this.addListener(eventName, listener, { 
        ...options, 
        priority: (options?.priority ?? 0) + 1 
      });
    }

    if (!options) {
      const current = this.events[key];
      if (!current) {
        this.events[key] = fn;
      } else if (typeof current === 'function') {
        this.events[key] = [fn, current]; // Prepend by putting new listener first
      } else {
        current.unshift(fn); // Add to beginning of array
        if (current.length > this.maxListeners && (current.length & (current.length - 1)) === 0) {
          console.warn(`[EventEmitter] Possible memory leak: ${current.length} listeners for "${String(key)}". Max: ${this.getMaxListeners()}`);
        }
      }
      return this;
    }

    return this.addListener(eventName, listener, { 
      ...options, 
      priority: (options.priority ?? 0) + 1 
    });
  }

  /**
   * Adds a one-time listener to the beginning of the listeners array
   * 
   * @param eventName - Name of the event to listen for
   * @param listener - Function to be called when event is emitted (only called once)
   * @param options - Additional listener options
   * @returns `this` for chaining
   * @example
   * ```typescript
   * // This one-time listener will execute before others
   * emitter.prependOnceListener('connection', (conn) => {
   *   console.log('First connection handler');
   * });
   * ```
   */
  prependOnceListener<K extends EventKey<T>>(eventName: K, listener: EventListener<T, K>, options?: ListenerOptions): this {
    const key = eventName as string | symbol;
    const fn = listener as any;
    
    if (!options) {
      const current = this.onceEvents[key];
      if (!current) {
        this.onceEvents[key] = fn;
      } else if (typeof current === 'function') {
        this.onceEvents[key] = [fn, current]; // Prepend
      } else {
        current.unshift(fn); // Add to beginning
      }
      return this;
    }
    
    return this.once(eventName, listener, { 
      ...options, 
      priority: (options.priority ?? 0) + 1 
    });
  }

  /**
   * Waits for the specified event to be emitted and returns a promise with the arguments
   * 
   * @param eventName - The event to wait for
   * @param timeout - Optional timeout in milliseconds
   * @returns Promise that resolves with the event arguments
   * @example
   * ```typescript
   * // Wait for data event (no timeout)
   * const [data] = await emitter.waitFor('data');
   * 
   * // Wait with 5 second timeout
   * try {
   *   const [user] = await emitter.waitFor('user:created', 5000);
   * } catch (error) {
   *   console.log('User creation timed out');
   * }
   * ```
   */
  waitFor<K extends EventKey<T>>(eventName: K, timeout?: number): Promise<EventArgs<T, K>> {
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      
      const handler = (...args: EventArgs<T, K>): void => {
        if (timer) clearTimeout(timer);
        resolve(args);
      };

      this.once(eventName, handler as EventListener<T, K>);

      if (timeout) {
        timer = setTimeout(() => {
          this.removeListener(eventName, handler as EventListener<T, K>);
          reject(new Error(`Timeout waiting for event "${String(eventName)}" after ${timeout}ms`));
        }, timeout);
      }
    });
  }

  /**
   * Waits for the first of multiple events to be emitted
   * 
   * @param events - The array of events racing against one another
   * @param timeout - Optional timeout in ms
   * @returns Promise that resolves with the winning event and its arguments
   * @example
   * ```typescript
   * // Wait for either success or error
   * const result = await emitter.race(['success', 'error'], 10000);
   * console.log(`Event ${result.event} occurred with:`, result.args);
   * 
   * // Handle different outcomes
   * if (result.event === 'success') {
   *   // Handle success
   * } else {
   *   // Handle error
   * }
   * ```
   */
  race<K extends EventKey<T>>(events: K[], timeout?: number): Promise<{ event: K; args: any[] }> {
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const handlers: Map<K, EventListener<T, K>> = new Map();
      let resolved = false;

      const cleanup = (): void => {
        if (timer) clearTimeout(timer);
        // Remove all handlers
        handlers.forEach((handler, eventName) => this.removeListener(eventName, handler));
        handlers.clear();
      };

      const resolveWith = (event: K, args: any[]): void => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve({ event, args });
        }
      };

      // Create handlers for each event
      events.forEach(eventName => {
        const handler = (...args: any[]): void => resolveWith(eventName, args);
        handlers.set(eventName, handler as EventListener<T, K>);
        this.once(eventName, handler as EventListener<T, K>);
      });

      if (timeout) {
        timer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            cleanup();
            reject(new Error(`Timeout: none of the events [${events.map(String).join(', ')}] occurred within ${timeout}ms`));
          }
        }, timeout);
      }
    });
  }
}

export default EventEmitter;
