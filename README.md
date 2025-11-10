
# @beltiston/events

A high-performance, feature-rich EventEmitter for TypeScript and JavaScript. Supports wildcard events, filtering, priority, once-listeners, async emission, propagation control, and event piping.

---

## Installation

```bash
npm install @beltiston/events
````

or

```bash
pnpm add @beltiston/events
```

---

## Basic Usage

```ts
import EventEmitter from "@beltiston/events";

interface AppEvents {
  data: (value: string) => void;
  error: (error: Error) => void;
}

const emitter = new EventEmitter<AppEvents>();

emitter.on("data", (val) => console.log("Data:", val));
emitter.emit("data", "hello world");
```

---

## Advanced Usage Examples

**Once-listeners**

```ts
emitter.once("data", (val) => console.log("First only:", val));
```

**Prepending listeners**

```ts
emitter.prependListener("data", (val) => console.log("Runs first:", val));
```

**Async emission**

```ts
await emitter.emitAsync("data", "async value");
```

**Waiting for events**

```ts
const [val] = await emitter.waitFor("data", 5000);
```

**Race between multiple events**

```ts
const result = await emitter.race(["data", "error"], 5000);
console.log(result.event, result.args);
```

**Piping events to another emitter**

```ts
const emitter2 = new EventEmitter<AppEvents>();
emitter.pipe(emitter2);
```

**Stopping propagation**

```ts
emitter.on("data", () => emitter.stopPropagation());
```

---

## API Reference

| Method                                           | Description                                                  | Returns                                                      |
| ------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| `addListener(event, listener, options?)`         | Add a listener with optional priority, times, ttl, or filter | `this`                                                       |
| `on(event, listener, options?)`                  | Alias for `addListener`                                      | `this`                                                       |
| `once(event, listener, options?)`                | Add a one-time listener                                      | `this`                                                       |
| `prependListener(event, listener, options?)`     | Add listener to start of array                               | `this`                                                       |
| `prependOnceListener(event, listener, options?)` | Add one-time listener to start                               | `this`                                                       |
| `removeListener(event?, listener?)`              | Remove specific or all listeners for an event                | `this`                                                       |
| `off(event?, listener?)`                         | Alias for `removeListener`                                   | `this`                                                       |
| `removeAllListeners(event?)`                     | Remove all listeners or for a specific event                 | `this`                                                       |
| `emit(event, ...args)`                           | Synchronously emit event with arguments                      | `boolean`                                                    |
| `emitAsync(event, ...args)`                      | Asynchronously emit event and wait for promises              | `Promise<boolean>`                                           |
| `stopPropagation()`                              | Stop event propagation to subsequent listeners               | `void`                                                       |
| `pipe(targetEmitter)`                            | Pipe events to another emitter                               | `this`                                                       |
| `unpipe(targetEmitter?)`                         | Remove piping to a target or all                             | `this`                                                       |
| `listenerCount(event?)`                          | Count listeners for a specific event or total                | `number`                                                     |
| `eventNames()`                                   | Return array of regular, once, and wildcard events           | `{ regular: string[], once: string[], wildcards: string[] }` |
| `listeners(event)`                               | Return array of listeners for the event                      | `Array<Function>`                                            |
| `rawListeners(event)`                            | Return original listeners, including wrapped once-listeners  | `Array<Function>`                                            |
| `setMaxListeners(n)`                             | Set maximum listeners per event                              | `this`                                                       |
| `getMaxListeners()`                              | Get maximum listeners per event                              | `number`                                                     |
| `waitFor(event, timeout?)`                       | Wait for the event to occur                                  | `Promise<any[]>`                                             |
| `race(events[], timeout?)`                       | Wait for the first of multiple events                        | `Promise<{ event: string, args: any[] }>`                    |
| `update(event, listener, options?, predicate?)`  | Replace existing listener(s) matching predicate              | `this`                                                       |
| `destroy()`                                      | Destroy emitter, remove all listeners, clear resources       | `void`                                                       |

---

## Integrating @beltiston/streams into @beltiston/events
to be written

## License

**LGPL-3.0** — GNU Lesser General Public License v3.0
See the [LICENSE](https://www.gnu.org/licenses/lgpl-3.0.html) file for full terms.

