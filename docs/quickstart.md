# Quickstart

This guide walks through using Meadow Connection Manager from scratch: install, register the service, open a named connection, test a configuration, manage multiple connections, and discover provider form schemas.

---

## Prerequisites

- Node.js 14 or later
- [fable](https://fable-retold.github.io/fable) for the service container
- At least one `meadow-connection-*` provider for the database engine you want to reach

---

## Install

```bash
npm install meadow-connection-manager fable
```

The manager itself has no database driver dependencies. Install the providers your application needs -- they are optional peer dependencies, so you only pull in the drivers you use:

```bash
npm install meadow-connection-mysql meadow-connection-sqlite
```

---

## Step 1: Register the Manager

The manager is a Fable service. Register and instantiate it like any other:

```javascript
const libFable = require('fable');
const libMeadowConnectionManager = require('meadow-connection-manager');

let _Fable = new libFable(
	{
		"Product": "QuickstartExample",
		"ProductVersion": "1.0.0",
		"UUID": { "DataCenter": 0, "Worker": 0 },
		"LogStreams": [{ "streamtype": "console" }]
	});

_Fable.serviceManager.addAndInstantiateServiceType(
	'MeadowConnectionManager', libMeadowConnectionManager);
```

After this, the manager is available at `_Fable.MeadowConnectionManager`.

---

## Step 2: Open a Named Connection

`connect()` takes a name, a configuration object, and a callback. The configuration's `Type` field selects the provider:

```javascript
_Fable.MeadowConnectionManager.connect('default',
	{
		Type: 'SQLite',
		SQLiteFilePath: '~/quickstart/data.sqlite'
	},
	(pError, pConnection) =>
	{
		if (pError)
		{
			console.error('Connection failed:', pError.message);
			return;
		}
		console.log(`Connected "${pConnection.name}" (${pConnection.type}) as [${pConnection.hash}]`);
		// => Connected "default" (SQLite) as [default]
	});
```

The callback receives the registered connection record:

```javascript
{
	name:     'default',     // the name you passed
	hash:     'default',     // URL-safe slug of the name
	type:     'SQLite',      // the provider Type
	config:   { /* ... */ }, // the config you passed
	instance: { /* ... */ }, // the live provider instance
	status:   'connected'
}
```

The live provider lives on `pConnection.instance` -- that is the object you query through. Its shape is defined by the provider module, not the manager. For SQLite, for example, `instance` exposes the underlying database handle; for MySQL it exposes a connection pool.

### Passing provider configuration

Two config styles are accepted. Flat keys sit alongside `Type` (the manager strips `Type`, `ProviderModule`, and `Name` and forwards the rest to the provider):

```javascript
{
	Type: 'MySQL',
	Server: '127.0.0.1',
	Port: 3306,
	User: 'root',
	Password: 'secret',
	Database: 'myapp'
}
```

Or nest the provider config under a key matching the `Type`:

```javascript
{
	Type: 'MySQL',
	MySQL:
	{
		Server: '127.0.0.1',
		Port: 3306,
		User: 'root',
		Password: 'secret',
		Database: 'myapp'
	}
}
```

If both are present, the nested `pConfig[Type]` object wins. Either way, each provider accepts the field names it documents -- consult the provider's own docs (for example [meadow-connection-mysql](https://fable-retold.github.io/meadow-connection-mysql)) for its configuration fields.

---

## Step 3: Test a Configuration

Before persisting a connection, validate it with `testConnection()`. It opens the config, issues a cheap liveness probe, tears the connection down, and never registers it:

```javascript
_Fable.MeadowConnectionManager.testConnection(
	{
		Type: 'MySQL',
		Server: 'db.example.com',
		Port: 3306,
		User: 'app',
		Password: 'secret',
		Database: 'myapp'
	},
	(pError, pResult) =>
	{
		// pError is null on both success and failure; read pResult
		if (pResult.Success)
		{
			console.log('Connection is reachable.');
		}
		else
		{
			console.log('Connection failed:', pResult.Error);
		}
	});
```

The probe matters for lazy-pool drivers (mysql, mysql2, node-postgres): creating a pool returns immediately without opening a socket, so a bad host or password only surfaces on the first real query. The probe forces a round-trip (`SELECT 1`, `ping`, and so on) so a misconfiguration is caught here. File-based and handshake-on-connect drivers are treated as already-probed.

---

## Step 4: Manage Multiple Connections

Open as many named connections as you need. Each name is sanitized into a URL-safe hash, and two different names may not collide onto the same hash:

```javascript
_Fable.MeadowConnectionManager.connect('analytics',
	{ Type: 'PostgreSQL', Server: 'analytics.db', Database: 'warehouse', User: 'reader', Password: 'secret' },
	(pError, pConnection) =>
	{
		// Look connections up later by name...
		let tmpAnalytics = _Fable.MeadowConnectionManager.getConnection('analytics');

		// ...or by hash (useful for route namespacing)
		let tmpByHash = _Fable.MeadowConnectionManager.getConnectionByHash('analytics');

		// Enumerate everything that's open
		console.log(_Fable.MeadowConnectionManager.getConnectionNames());
		// => [ 'default', 'analytics' ]

		console.log(_Fable.MeadowConnectionManager.listConnections());
		// => [ { name: 'default', type: 'SQLite', status: 'connected' },
		//      { name: 'analytics', type: 'PostgreSQL', status: 'connected' } ]
	});
```

Calling `getConnection()` with no argument returns the `default` connection. Close one with `disconnect()`:

```javascript
_Fable.MeadowConnectionManager.disconnect('analytics',
	(pError) =>
	{
		console.log('analytics closed');
	});
```

`disconnect()` calls the provider's `close()` method if it has one, then removes the connection from both the name and hash indexes. Disconnecting an unknown name is a no-op (the callback fires with no error).

---

## Step 5: Discover Which Providers Are Installed

Because drivers are optional, you often want to know what is actually available before offering it to a user. `getAvailableProviders()` reports the install status of every known provider type:

```javascript
let tmpAvailable = _Fable.MeadowConnectionManager.getAvailableProviders();
console.log(tmpAvailable);
// => { MySQL: true, PostgreSQL: false, MSSQL: false, Oracle: false,
//      SQLite: true, Solr: false, RocksDB: false, MongoDB: false, ... }
```

---

## Step 6: Discover Provider Form Schemas

Each provider ships a connection-form schema describing the fields needed to connect to it. `getAllProviderFormSchemas()` collects the schemas of every *installed* provider, ready to serialize to a browser:

```javascript
let tmpSchemas = _Fable.MeadowConnectionManager.getAllProviderFormSchemas();

for (let i = 0; i < tmpSchemas.length; i++)
{
	console.log(`${tmpSchemas[i].DisplayName}: ${tmpSchemas[i].Fields.length} field(s)`);
}
```

Each schema has the shape:

```javascript
{
	Provider:    'SQLite',
	DisplayName: 'SQLite',
	Description: 'Open or create a local SQLite database file.',
	Fields:
	[
		{ Name: 'SQLiteFilePath', Label: 'SQLite File Path', Type: 'Path', Required: true /* ... */ }
	]
}
```

Schemas are loaded without triggering the underlying driver `require()`, so a provider's schema is available even when its native driver is not installed -- but only if the provider *module* is present. This feed is what [pict-section-connection-form](https://fable-retold.github.io/pict-section-connection-form) renders.

For one provider's schema specifically, use `getProviderFormSchema(pType)`, which returns the schema object or `null` if the provider isn't installed or has no schema file.

---

## Summary

| Step | Method | What It Does |
|------|--------|-------------|
| Register | `addAndInstantiateServiceType` | Add the manager to a Fable instance |
| Connect | `connect(name, config, cb)` | Load the provider for `config.Type` and register the connection |
| Test | `testConnection(config, cb)` | Open, probe, and tear down a config without registering it |
| Look up | `getConnection` / `getConnectionByHash` | Retrieve a registered connection |
| Enumerate | `getConnectionNames` / `listConnections` | See what is open |
| Disconnect | `disconnect(name, cb)` | Close and unregister a connection |
| Discover | `getAvailableProviders` | See which provider modules are installed |
| Discover | `getAllProviderFormSchemas` | Collect connection-form schemas for installed providers |
