# Meadow Connection Manager

> The server-side loader and factory for Meadow database connections

Reads a connection configuration, dispatches on its `Type` to the matching `meadow-connection-*` provider, connects it, and registers the live connection under a name. Drivers are optional peer dependencies, so it fails gracefully for any provider that isn't installed.

- **Type-Dispatched Loading** -- One `connect()` call loads the right provider by `Type`
- **Named Connections** -- Register and look up connections by name or URL-safe hash
- **Graceful Fallback** -- Missing optional drivers report a clear error, never a load-time crash
- **Connection Probing** -- `testConnection()` proves a config can actually reach the server
- **Form-Schema Discovery** -- Collect each installed provider's connection-form schema for UIs

[Get Started](README.md)
[Quickstart](quickstart.md)
[Architecture](architecture.md)
[API Reference](api.md)
[GitHub](https://github.com/fable-retold/meadow-connection-manager)

