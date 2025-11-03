# EventEmitter

A high-performance, feature-rich event emitter implementation for TypeScript/JavaScript with advanced capabilities including wildcard events, filtering, propagation control, and async support.

## Features

- **🚀 High Performance**: Optimized emit paths with minimal overhead
- **🎯 Type-Safe**: Full TypeScript support with generic event maps
- **🌟 Wildcard Events**: Support for glob-style patterns (`user.*`, `data.?.updated`)
- **⚡ Priority Listeners**: Control execution order with priority levels
- **🔄 Event Piping**: Forward events between emitters
- **⏱️ TTL & Limited Execution**: Auto-remove listeners after timeout or execution count
- **🎨 Filtering**: Conditionally execute listeners based on event arguments
- **🔌 Event Streams**: Functional reactive programming with chainable operators
- **🌐 Transport Layer**: Cross-context event communication (WebSocket, MessageChannel, BroadcastChannel)
- **🧹 Auto Cleanup**: Automatic removal of stale listeners
- **🛑 Propagation Control**: Stop event propagation to subsequent listeners
- **⏳ Async Support**: Promise-based event emission with `emitAsync` and `waitFor`

## Installation

```bash
npm install @beltiston/event-emitter
```

## Quick Start

```typescript
import { EventEmitter } from '@beltiston/event-emitter';

// Define your event types
type MyEvents = {
  'data': (data: string) => void;
  'error': (error: Error) => void;
  'user:created': (user: User, timestamp: number) => void;
}

// Create an emitter
const emitter = new EventEmitter<MyEvents>();

// Add listeners
emitter.on('data', (data) => {
  console.log('Received:', data);
});

// Emit events
emitter.emit('data', 'Hello World!');
```

## Advanced Usage

### Wildcard Events

```typescript
// Listen to all user events
emitter.on('user:*', (data) => {
  console.log('User event:', data);
});

// Single character wildcard
emitter.on('user:?.updated', (data) => {
  console.log('User updated:', data);
});

emitter.emit('user:123', userData);      // Matches user:*
emitter.emit('user:1.updated', userData); // Matches user:?.updated
```

### Priority & Options

```typescript
// High priority listener (executes first)
emitter.on('data', handler1, { priority: 10 });

// Limited execution (only 5 times)
emitter.on('data', handler2, { times: 5 });

// Auto-remove after 30 seconds
emitter.on('data', handler3, { ttl: 30000 });

// Conditional execution
emitter.on('data', handler4, {
  filter: ([data]) => data.length > 10
});
```

### Async Operations

```typescript
// Wait for an event
const [user] = await emitter.waitFor('user:created', 5000);

// Race multiple events
const { event, args } = await emitter.race(['success', 'error'], 10000);

// Emit with async handlers
await emitter.emitAsync('process', data);
```

### Event Piping

```typescript
const emitter1 = new EventEmitter();
const emitter2 = new EventEmitter();

// Forward all events from emitter1 to emitter2
emitter1.pipe(emitter2);

emitter1.emit('data', 'hello'); // Also emitted on emitter2
```

### Event Streams

```typescript
const stream = emitter.stream('data')
  .filter(([data]) => data.length > 5)
  .map(([data]) => data.toUpperCase())
  .forEach((data) => console.log(data));
```

### Cross-Context Communication

```typescript
// WebSocket transport
const transporter = emitter.transporter({
  protocol: 'ws',
  url: 'ws://localhost:8080'
});

await transporter.connect();
// Events are now synchronized across the connection
```

## API Reference

### Core Methods

- `on(event, listener, options?)` - Add a listener
- `once(event, listener, options?)` - Add a one-time listener
- `off(event?, listener?)` - Remove listener(s)
- `emit(event, ...args)` - Emit an event synchronously
- `emitAsync(event, ...args)` - Emit an event asynchronously
- `removeAllListeners(event?)` - Remove all listeners

### Advanced Methods

- `waitFor(event, timeout?)` - Wait for an event to occur
- `race(events[], timeout?)` - Wait for first of multiple events
- `pipe(target)` - Forward events to another emitter
- `stream(event)` - Create an event stream
- `transporter(options)` - Create cross-context transport
- `stopPropagation()` - Stop current event propagation

### Utility Methods

- `listeners(event)` - Get listeners for an event
- `rawListeners(event)` - Get unwrapped listeners
- `listenerCount(event?)` - Count listeners
- `eventNames()` - Get all event names
- `setMaxListeners(n)` - Set max listeners per event
- `destroy()` - Cleanup and destroy emitter

## Configuration

```typescript
const emitter = new EventEmitter({
  autoCleanup: true,              // Enable auto cleanup
  autoCleanupThreshold: 300000    // 5 minutes (default)
});
```

## Performance

This implementation uses several optimization techniques:

- **Fast-path emit**: Specialized code paths for common argument counts (0-5 args)
- **Bit flags**: Efficient feature detection without boolean checks
- **Array pooling**: Reuses argument arrays to reduce allocations
- **Pattern caching**: Compiled regex patterns are cached
- **Minimal overhead**: Direct function calls when no advanced features are used

## License

LGPLv3
