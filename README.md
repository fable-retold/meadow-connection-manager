# Meadow Connection Manager

> **[Read the Meadow-Connection-Manager Documentation](https://fable-retold.github.io/meadow-connection-manager/)** - interactive docs with the full API reference.

The server-side loader for Meadow database connections. It reads a connection configuration, dispatches on the `Type` field to the matching `meadow-connection-*` provider module, instantiates and connects it, and registers the live connection under a name. Database drivers are optional peer dependencies, so an application installs only the providers it actually uses and the manager fails gracefully for the rest.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Features

- **Type-Dispatched Provider Loading** -- A single `connect()` call reads the `Type` field of a config and loads the matching `meadow-connection-*` module by name.
- **Named Connections** -- Registers each live connection under a name (`default`, `analytics`, ...) and indexes it by a URL-safe hash for route namespacing.
- **Graceful Driver Fallback** -- Every database driver is an *optional* peer dependency. A missing module yields a descriptive error from `connect()` (and is simply skipped by the discovery methods) rather than crashing at load time.
- **Connection Probing** -- `testConnection()` opens a config, issues a cheap per-driver round-trip (`SELECT 1`, `ping`, ...), then tears it down -- so lazy connection pools cannot report success against an unreachable server.
- **Form-Schema Discovery** -- `getAllProviderFormSchemas()` collects the connection-form schema from each installed provider so a UI can render a "Connect to X" form from one canonical source.
- **Connection-Name Sanitizer** -- A standalone helper turns a human-readable name into a deterministic, idempotent, URL-safe slug.

## Installation

```bash
npm install meadow-connection-manager
```

Then install the driver providers your application needs. They are optional peer dependencies:

```bash
npm install meadow-connection-mysql meadow-connection-sqlite
```

## Quick Start

```javascript
const libFable = require('fable');
const libMeadowConnectionManager = require('meadow-connection-manager');

let _Fable = new libFable(
	{
		Product: 'MyApp'
	});

_Fable.serviceManager.addAndInstantiateServiceType(
	'MeadowConnectionManager', libMeadowConnectionManager);

_Fable.MeadowConnectionManager.connect('default',
	{
		Type: 'SQLite',
		SQLiteFilePath: '~/myapp/data.sqlite'
	},
	(pError, pConnection) =>
	{
		if (pError)
		{
			return console.error(pError);
		}
		console.log(`Connected "${pConnection.name}" (${pConnection.type}) as [${pConnection.hash}]`);
	});
```

## How It Works

`connect(pName, pConfig, fCallback)` performs the dispatch:

1. **Resolve the provider module** from `pConfig.Type` (or `pConfig.ProviderModule` to override) against the built-in dispatch table.
2. **`require()` the module.** If it (or its underlying driver) is not installed, the callback receives an error explaining which `npm install` is needed -- the manager never throws at load time for a missing optional provider.
3. **Build the provider config** from either a nested `pConfig[Type]` object or the flat keys on `pConfig` (excluding `Type`, `ProviderModule`, and `Name`).
4. **Instantiate and connect** the provider, then register the live connection as `{ name, hash, type, config, instance, status }`.

Each provider reads its settings from `fable.settings[Type]`; the manager sets that key just long enough for the provider constructor to read it, then restores the prior value.

## Supported Provider Types

| `Type` | Provider module |
|--------|-----------------|
| `MySQL` | `meadow-connection-mysql` |
| `PostgreSQL` | `meadow-connection-postgresql` |
| `MSSQL` | `meadow-connection-mssql` |
| `Oracle` | `meadow-connection-oracle` |
| `SQLite` | `meadow-connection-sqlite` |
| `Solr` | `meadow-connection-solr` |
| `RocksDB` | `meadow-connection-rocksdb` |
| `MongoDB` | `meadow-connection-mongodb` |
| `Bibliograph` | `bibliograph` |
| `RetoldDataBeacon` | `meadow-connection-retold-databeacon` |
| `MeadowEndpoints` | `meadow-connection-meadow-endpoints` |

The default provider type is `MySQL` when no `Type` is given.

## API at a Glance

| Method | Purpose |
|--------|---------|
| `connect(pName, pConfig, fCallback)` | Load a provider by `Type`, connect, and register the connection under a name. |
| `disconnect(pName, fCallback)` | Close and unregister a named connection. |
| `testConnection(pConfig, fCallback)` | Open, probe, and tear down a config without registering it. |
| `getConnection(pName)` | Look up a registered connection by name. |
| `getConnectionByHash(pHash)` | Look up a registered connection by its sanitized hash. |
| `getConnectionNames()` | List the names of all registered connections. |
| `listConnections()` | List `{ name, type, status }` for all registered connections. |
| `getAvailableProviders()` | Report which provider modules are installed (`{ Type: boolean }`). |
| `getProviderFormSchema(pType)` | Load one provider's connection-form schema, or `null`. |
| `getAllProviderFormSchemas()` | Collect the form schemas of every installed provider. |

The connection-name sanitizer is also exported as a static helper:

```javascript
const libMeadowConnectionManager = require('meadow-connection-manager');
let tmpHash = libMeadowConnectionManager.sanitizeConnectionName('Analytics Warehouse'); // 'analytics-warehouse'
```

See the [API Reference](https://fable-retold.github.io/meadow-connection-manager/#/api) for full details.

## Part of the Retold Framework

Meadow Connection Manager is the hub of the Meadow connection family:

- [meadow](https://github.com/fable-retold/meadow) -- ORM and data access framework
- [meadow-connection-mysql](https://github.com/fable-retold/meadow-connection-mysql) -- MySQL provider
- [meadow-connection-postgresql](https://github.com/fable-retold/meadow-connection-postgresql) -- PostgreSQL provider
- [meadow-connection-mssql](https://github.com/fable-retold/meadow-connection-mssql) -- MSSQL provider
- [meadow-connection-sqlite](https://github.com/fable-retold/meadow-connection-sqlite) -- SQLite provider
- [retold-data-service](https://github.com/fable-retold/retold-data-service) -- Auto-REST data service that drives the manager
- [pict-section-connection-form](https://github.com/fable-retold/pict-section-connection-form) -- Renders connection forms from the discovered schemas
- [fable](https://github.com/fable-retold/fable) -- Application services framework

## Testing

Run the test suite:

```bash
npm test
```

## License

MIT

## Contributing

Pull requests are welcome. For details on our code of conduct, contribution process, and testing requirements, see the [Retold Contributing Guide](https://github.com/stevenvelozo/retold/blob/main/docs/contributing.md).
