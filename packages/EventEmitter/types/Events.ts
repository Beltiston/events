export type EventMap = Record<string | symbol, (...args: any[]) => void>;

export type EventKey<T> = T extends EventMap ? keyof T : never;

export type EventArgs<T, K extends EventKey<T>> =
  T extends object
    ? K extends keyof T
      ? T[K] extends (...args: infer Args) => any
        ? Args
        : never
      : never
    : never;

export type EventListener<
  TEventMap extends EventMap,
  K extends keyof TEventMap
> = TEventMap[K] extends (...args: infer A) => any
  ? (...args: A) => void | Promise<void>
  : never;

export type EventEmitterOptions = {
  autoCleanup?: boolean;
  autoCleanupThreshold?: number;
};
