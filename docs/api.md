# API Reference

`MeadowConnectionManager` is a Fable service provider (it extends `fable-serviceproviderbase`). Register it with a Fable instance and access it through the service registry:

```javascript
const libMeadowConnectionManager = require('meadow-connection-manager');

_Fable.serviceManager.addAndInstantiateServiceType(
	'MeadowConnectionManager', libMeadowConnectionManager);

let _Manager = _Fable.MeadowConnectionManager;
```

`serviceType` is `'MeadowConnectionManager'`.

---

## Connection Lifecycle

### `connect(pName, pConfig, fCallback)`

Load the provider for `pConfig.Type`, instantiate and connect it, and register the live connection under `pName`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `pName` | `string` | Connection name. Defaults to `'default'` if falsy. |
| `pConfig` | `object` | Connection configuration (see below). May be omitted; if `pConfig` is a function it is treated as the callback. |
| `fCallback` | `function` | `function(pError, pConnection)`. |

**Configuration fields read by the manager:**

| Field | Description |
|-------|-------------|
| `Type` | Provider type key (e.g. `'MySQL'`). Selects the provider module. Defaults to the `DefaultProvider` option (`'MySQL'`). |
| `ProviderModule` | Optional. An explicit npm module name to load instead of looking `Type` up in the dispatch table. |
| `Name` | Reserved -- excluded from the provider config. |
| *(other keys)* | Forwarded to the provider as its configuration, unless a nested `pConfig[Type]` object is present, in which case that object is used instead. |

**On success**, the callback receives the registered connection record:

```javascript
{
	name:     'default',     // pName
	hash:     'default',     // sanitized slug of pName
	type:     'MySQL',       // pConfig.Type
	config:   { /* ... */ }, // the original pConfig
	instance: { /* ... */ }, // the live provider instance
	status:   'connected'
}
```

**Errors** (passed as `pError`) occur when:

- the connection name sanitizes to an empty string, or its hash is already owned by a *different* connection;
- the provider `Type` is unknown and no `ProviderModule` is given;
- the provider module cannot be loaded (not installed) -- the error names the `npm install` to run;
- the provider fails to instantiate or its `connectAsync` reports a connection error.

```javascript
_Manager.connect('default',
	{ Type: 'SQLite', SQLiteFilePath: '~/app/data.sqlite' },
	(pError, pConnection) =>
	{
		if (pError)
		{
			return console.error(pError.message);
		}
		console.log(pConnection.status); // 'connected'
	});
```

---

### `disconnect(pName, fCallback)`

Close and unregister a named connection. If the provider instance exposes a `close(callback)` method it is called first. The connection is removed from both the name index and the hash index.

| Parameter | Type | Description |
|-----------|------|-------------|
| `pName` | `string` | Connection name. Defaults to `'default'`. |
| `fCallback` | `function` | `function(pError)`. |

Disconnecting an unregistered name is a no-op -- the callback fires with no error.

```javascript
_Manager.disconnect('analytics',
	(pError) =>
	{
		console.log('closed');
	});
```

---

### `testConnection(pConfig, fCallback)`

Open `pConfig` under a throwaway name, issue a cheap per-driver liveness probe, then disconnect. The connection is never registered.

| Parameter | Type | Description |
|-----------|------|-------------|
| `pConfig` | `object` | The configuration to test (same shape as `connect`). |
| `fCallback` | `function` | `function(pError, pResult)`. |

`pError` is `null` on both success and failure; read `pResult`:

| Result | Shape |
|--------|-------|
| Success | `{ Success: true }` |
| Failure | `{ Success: false, Error: '<message>' }` |

The probe forces a real round-trip so lazy connection pools cannot report success against an unreachable server. See [Architecture](architecture.md) for the per-type probe table.

```javascript
_Manager.testConnection(
	{ Type: 'MySQL', Server: 'db.example.com', User: 'app', Password: 'secret', Database: 'myapp' },
	(pError, pResult) =>
	{
		console.log(pResult.Success ? 'reachable' : pResult.Error);
	});
```

---

## Queries

### `getConnection(pName)`

Return the registered connection record for `pName`, or `null` if none exists. With no argument, returns the `'default'` connection.

```javascript
let tmpConn = _Manager.getConnection('analytics');
if (tmpConn) { /* query through tmpConn.instance */ }
```

### `getConnectionByHash(pHash)`

Return the registered connection record whose sanitized hash equals `pHash`, or `null`. Useful for resolving a connection from a route segment.

### `getConnectionNames()`

Return a `string[]` of all registered connection names.

### `listConnections()`

Return an array of connection metadata, omitting the live instances:

```javascript
[
	{ name: 'default',   type: 'SQLite',     status: 'connected' },
	{ name: 'analytics', type: 'PostgreSQL', status: 'connected' }
]
```

---

## Provider Discovery

### `getAvailableProviders()`

Report which provider modules are installed. Returns an object keyed by every known provider type, with a boolean value (resolved via `require.resolve()`):

```javascript
{
	MySQL: true,  PostgreSQL: false, MSSQL: false, Oracle: false,
	SQLite: true, Solr: false, RocksDB: false, MongoDB: false,
	Bibliograph: false, RetoldDataBeacon: false, MeadowEndpoints: false
}
```

---

## Form-Schema Discovery

### `getProviderFormSchema(pType)`

Load one provider's connection-form schema. The schema file is resolved through the provider module's `package.json` and loaded **without** loading the provider's main entry point, so it works even when the native driver is not installed.

| Parameter | Type | Description |
|-----------|------|-------------|
| `pType` | `string` | Provider type key, e.g. `'MySQL'`. |

**Returns** the schema object, or `null` if the provider type is unregistered, its module is not installed, or it has no schema file.

```javascript
{
	Provider:    'MySQL',
	DisplayName: 'MySQL',
	Description: '...',
	Fields:
	[
		{ Name: 'Server', Label: 'Server', Type: 'String', Default: '127.0.0.1', Required: true /* ... */ }
	]
}
```

Each field carries at least `Name`, `Label`, and `Type`.

### `getAllProviderFormSchemas()`

Return an array of schema objects -- one for every provider whose module is currently installed and exposes a schema file -- in a stable provider-type order. Providers that are not installed (or whose schema file is missing) are silently skipped, so the array may be empty.

```javascript
let tmpSchemas = _Manager.getAllProviderFormSchemas();
// suitable for serializing to a browser provider-picker UI
```

This is the feed consumed by [pict-section-connection-form](https://fable-retold.github.io/pict-section-connection-form).

---

## Static Exports

### `MeadowConnectionManager.sanitizeConnectionName(pName)`

The connection-name sanitizer, exported on the module for use without instantiating the manager.

| Parameter | Type | Description |
|-----------|------|-------------|
| `pName` | `string` | A human-readable connection name. |

**Returns** the sanitized, URL-safe slug. **Throws** if `pName` is not a non-empty string, or if it sanitizes to an empty string.

```javascript
const libMeadowConnectionManager = require('meadow-connection-manager');

libMeadowConnectionManager.sanitizeConnectionName('Analytics Warehouse'); // 'analytics-warehouse'
libMeadowConnectionManager.sanitizeConnectionName('Über DB');             // 'uber-db'
```

The sanitizer module also exposes `MAX_HASH_LENGTH` (`64`), the maximum slug length.

---

## Options

Passed as the service options when instantiating the manager:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `DefaultProvider` | `string` | `'MySQL'` | Provider `Type` used when a config omits `Type`. |
| `MySQL` | `object` | (see below) | Default MySQL field values. |
| `Oracle` | `object` | (see below) | Default Oracle field values. |

The built-in defaults are:

```javascript
{
	DefaultProvider: 'MySQL',
	MySQL:
	{
		server: '127.0.0.1', port: 3306, user: 'root',
		password: '', database: 'meadow', connectionLimit: 20
	},
	Oracle:
	{
		server: '127.0.0.1', port: 1521, user: 'app', password: '',
		connectionType: 'ServiceName', serviceName: 'XEPDB1', connectionLimit: 10
	}
}
```
