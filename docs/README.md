# Meadow Connection Manager

The server-side loader for Meadow database connections. Hand it a connection configuration and it dispatches on the `Type` field to the matching `meadow-connection-*` provider, instantiates and connects it, and registers the live connection under a name you can look up later.

Database drivers are *optional* peer dependencies. An application installs only the providers it uses; the manager reports a clear error for any provider that isn't installed instead of crashing at load time.

## Why It Exists

A Retold application rarely talks to a single, hard-coded database. A content service might run against SQLite locally and PostgreSQL in production; a data-mapping tool might hold several named connections open at once across different engines. The manager is the one place that knows how to turn a plain config object into a live, named connection -- without the calling code having to `require()` a specific driver or know its constructor shape.

```javascript
const libFable = require('fable');
const libMeadowConnectionManager = require('meadow-connection-manager');

let _Fable = new libFable({ Product: 'MyApp' });

_Fable.serviceManager.addAndInstantiateServiceType(
	'MeadowConnectionManager', libMeadowConnectionManager);

_Fable.MeadowConnectionManager.connect('default',
	{
		Type: 'SQLite',
		SQLiteFilePath: '~/myapp/data.sqlite'
	},
	(pError, pConnection) =>
	{
		console.log(`Connected "${pConnection.name}" (${pConnection.type})`);
	});
```

## What It Does

- **Type-dispatched loading.** `connect()` reads `pConfig.Type` and loads the matching `meadow-connection-*` module by name from a built-in dispatch table.
- **Named connections.** Each connection is registered under a name and indexed by a URL-safe hash derived from that name, so it can be reused for route namespacing.
- **Graceful fallback.** A missing optional driver yields a descriptive `connect()` error and is silently skipped by the discovery methods -- never a load-time crash.
- **Connection probing.** `testConnection()` opens a config, issues a cheap per-driver liveness round-trip, then tears it down so lazy pools cannot falsely report success.
- **Form-schema discovery.** `getAllProviderFormSchemas()` gathers each installed provider's connection-form schema so a UI can render provider-picker forms from one source.

## Where It Sits

```
Configuration ({ Type, ...fields })
        |
  Meadow Connection Manager   <- this module: dispatch + lifecycle + discovery
        |
  meadow-connection-<Type>    <- the provider that owns the driver
        |
  Database driver (mysql2, node:sqlite, pg, ...)
        |
  Database server / file
```

The manager is a hub; each `meadow-connection-*` provider is a spoke. See [Architecture](architecture.md) for the full hub-and-spoke model and the connection lifecycle.

## Documentation

- [Quickstart](quickstart.md) -- Install, connect, query, and discover providers step by step.
- [Architecture](architecture.md) -- The hub-and-spoke model, the dispatch table, lifecycle, and graceful fallback.
- [API Reference](api.md) -- Every method, its parameters, and the connection record shape.

## Related Modules

This module is the server-side hub of the Meadow connection family. The provider spokes:

- [meadow-connection-mysql](https://fable-retold.github.io/meadow-connection-mysql)
- [meadow-connection-postgresql](https://fable-retold.github.io/meadow-connection-postgresql)
- [meadow-connection-mssql](https://fable-retold.github.io/meadow-connection-mssql)
- [meadow-connection-sqlite](https://fable-retold.github.io/meadow-connection-sqlite)

And the modules that build on top of it:

- [retold-data-service](https://fable-retold.github.io/retold-data-service) -- Auto-REST data service that uses the manager to open the databases it serves.
- [pict-section-connection-form](https://fable-retold.github.io/pict-section-connection-form) -- Renders connection forms from the schemas the manager discovers.
- [pict-meadow-connection-manager](https://fable-retold.github.io/pict-meadow-connection-manager) -- Browser-side provider and views for managing named connections.
