/**
 * Meadow-ConnectionManager
 *
 * Server-side fable service that manages named database connections.
 * Parses connection configurations and instantiates the appropriate
 * meadow provider module.  Database drivers are peer dependencies —
 * the consuming application installs only the drivers it needs.
 *
 * Supports: MySQL, PostgreSQL, MSSQL, SQLite, Solr, RocksDB, MongoDB.
 *
 * Default connection is 'default' pointing at MySQL on localhost.
 *
 * @module Meadow-ConnectionManager
 */

'use strict';

const libFableServiceProviderBase = require('fable-serviceproviderbase');
const libPath = require('path');
const libSanitizeConnectionName = require('./Meadow-ConnectionManager-Sanitize.js');

/**
 * Map of provider type names to their npm module names.
 */
const PROVIDER_MODULES =
{
	'MySQL':            'meadow-connection-mysql',
	'PostgreSQL':       'meadow-connection-postgresql',
	'MSSQL':            'meadow-connection-mssql',
	'SQLite':           'meadow-connection-sqlite',
	'Solr':             'meadow-connection-solr',
	'RocksDB':          'meadow-connection-rocksdb',
	'MongoDB':          'meadow-connection-mongodb',
	'Bibliograph':      'bibliograph',
	'RetoldDataBeacon': 'meadow-connection-retold-databeacon',
	'MeadowEndpoints':  'meadow-connection-meadow-endpoints',
};

/**
 * Path within each module to its form-schema file, relative to the
 * module's package.json.  Most providers follow the
 * `Meadow-Connection-<Type>-FormSchema.js` naming convention, but
 * Bibliograph isn't a meadow-connection-* module so it uses a shorter
 * name.  Providers without an entry here return null from the form
 * schema accessors (e.g., RetoldDataBeacon — schema not yet defined).
 */
const FORM_SCHEMA_PATHS =
{
	'MySQL':           'source/Meadow-Connection-MySQL-FormSchema.js',
	'PostgreSQL':      'source/Meadow-Connection-PostgreSQL-FormSchema.js',
	'MSSQL':           'source/Meadow-Connection-MSSQL-FormSchema.js',
	'SQLite':          'source/Meadow-Connection-SQLite-FormSchema.js',
	'Solr':            'source/Meadow-Connection-Solr-FormSchema.js',
	'RocksDB':         'source/Meadow-Connection-RocksDB-FormSchema.js',
	'MongoDB':         'source/Meadow-Connection-MongoDB-FormSchema.js',
	'Bibliograph':     'source/Bibliograph-FormSchema.js',
	'MeadowEndpoints': 'source/Meadow-Connection-MeadowEndpoints-FormSchema.js',
};

/**
 * Resolve the path to a provider module's form-schema file without
 * loading the module's main entry (which would trigger the underlying
 * driver `require()` and fail if the optional peer dep is missing).
 *
 * Returns null if the module isn't installed or if the provider type
 * doesn't yet have a form-schema file.
 */
function _resolveFormSchemaPath(pType)
{
	let tmpModuleName = PROVIDER_MODULES[pType];
	let tmpRelativePath = FORM_SCHEMA_PATHS[pType];
	if (!tmpModuleName || !tmpRelativePath) { return null; }

	let tmpPackageJSONPath;
	try
	{
		tmpPackageJSONPath = require.resolve(tmpModuleName + '/package.json');
	}
	catch (pError)
	{
		return null;
	}
	let tmpModuleDir = libPath.dirname(tmpPackageJSONPath);
	return libPath.join(tmpModuleDir, tmpRelativePath);
}

const defaultConnectionManagerOptions =
{
	// Default provider type when none is specified
	DefaultProvider: 'MySQL',

	// Default MySQL configuration
	MySQL:
	{
		server: '127.0.0.1',
		port: 3306,
		user: 'root',
		password: '',
		database: 'meadow',
		connectionLimit: 20,
	},
};

class MeadowConnectionManager extends libFableServiceProviderBase
{
	constructor(pFable, pOptions, pServiceHash)
	{
		super(pFable, pOptions, pServiceHash);

		this.serviceType = 'MeadowConnectionManager';

		// Named connections: { name: { name, hash, type, config, instance, status } }
		this._Connections = {};
		// Reverse index: hash → same connection reference (for getConnectionByHash)
		this._ConnectionsByHash = {};
	}

	// ─────────────────────────────────────────────
	//  Connection lifecycle
	// ─────────────────────────────────────────────

	/**
	 * Connect to a database and register the connection under a name.
	 *
	 * @param {string} pName — connection name (e.g. 'default', 'analytics')
	 * @param {object} pConfig — connection configuration
	 * @param {string} pConfig.Type — provider type (e.g. 'MySQL', 'SQLite')
	 * @param {object} [pConfig.*] — provider-specific configuration
	 * @param {function} fCallback — function(pError, pConnection)
	 */
	connect(pName, pConfig, fCallback)
	{
		if (typeof pConfig === 'function')
		{
			fCallback = pConfig;
			pConfig = {};
		}

		let tmpName = pName || 'default';
		let tmpConfig = pConfig || {};
		let tmpType = tmpConfig.Type || this.options.DefaultProvider || 'MySQL';

		// Compute a URL-safe hash from the connection name for route namespacing
		let tmpHash;
		try
		{
			tmpHash = libSanitizeConnectionName(tmpName);
		}
		catch (pSanitizeError)
		{
			return fCallback(pSanitizeError);
		}

		// Reject if a DIFFERENT connection name already owns this hash
		let tmpExistingByHash = this._ConnectionsByHash[tmpHash];
		if (tmpExistingByHash && tmpExistingByHash.name !== tmpName)
		{
			return fCallback(new Error(
				`MeadowConnectionManager: connection name "${tmpName}" sanitizes to hash "${tmpHash}" ` +
				`which is already in use by connection "${tmpExistingByHash.name}".`));
		}

		let tmpModuleName = tmpConfig.ProviderModule || PROVIDER_MODULES[tmpType];
		if (!tmpModuleName)
		{
			return fCallback(new Error(`MeadowConnectionManager: unknown provider type "${tmpType}"`));
		}

		// Load the provider module
		let tmpProviderModule;
		try
		{
			tmpProviderModule = require(tmpModuleName);
		}
		catch (pLoadError)
		{
			return fCallback(new Error(
				`MeadowConnectionManager: could not load provider "${tmpModuleName}" for type "${tmpType}". ` +
				`Ensure the module is installed: npm install ${tmpModuleName}. ` +
				`Original error: ${pLoadError.message}`));
		}

		// Ensure the provider service class is registered
		if (!this.fable.serviceClasses || !this.fable.serviceClasses[tmpModuleName])
		{
			this.fable.addServiceType(tmpModuleName, tmpProviderModule);
		}

		// Build provider-specific config
		let tmpProviderConfig = {};
		if (tmpConfig[tmpType])
		{
			tmpProviderConfig = tmpConfig[tmpType];
		}
		else
		{
			// Extract provider config from flat keys (excluding Type and ProviderModule)
			let tmpKeys = Object.keys(tmpConfig);
			for (let i = 0; i < tmpKeys.length; i++)
			{
				if (tmpKeys[i] !== 'Type' && tmpKeys[i] !== 'ProviderModule' && tmpKeys[i] !== 'Name')
				{
					tmpProviderConfig[tmpKeys[i]] = tmpConfig[tmpKeys[i]];
				}
			}
		}

		// Set fable.settings[Type] so providers can find their config
		// (most meadow-connection providers read from fable.settings[Type])
		// Save previous value to restore after instantiation
		let tmpPrevSettings = this.fable.settings[tmpType];
		this.fable.settings[tmpType] = tmpProviderConfig;
		this.log.trace(`MCM: set fable.settings.${tmpType} = ${JSON.stringify(tmpProviderConfig)}, verify: ${JSON.stringify(this.fable.settings[tmpType])}`);

		// Instantiate the provider
		// Providers read config from fable.settings[Type] (set above) which
		// handles both PascalCase and lowercase field names via coercion.
		// We pass an empty options object so the provider uses the settings path.
		let tmpInstance;
		try
		{
			tmpInstance = this.fable.serviceManager.instantiateServiceProviderWithoutRegistration(
				tmpModuleName, {});
		}
		catch (pInstantiateError)
		{
			// Restore previous settings on failure
			if (tmpPrevSettings !== undefined)
			{
				this.fable.settings[tmpType] = tmpPrevSettings;
			}
			else
			{
				delete this.fable.settings[tmpType];
			}
			return fCallback(new Error(
				`MeadowConnectionManager: failed to instantiate "${tmpType}" provider: ${pInstantiateError.message}`));
		}

		// Restore previous settings (provider constructor already read what it needed)
		if (tmpPrevSettings !== undefined)
		{
			this.fable.settings[tmpType] = tmpPrevSettings;
		}
		else
		{
			delete this.fable.settings[tmpType];
		}

		// Connect the provider (providers require connectAsync to be usable)
		if (typeof tmpInstance.connectAsync === 'function')
		{
			tmpInstance.connectAsync(
				(pConnectError) =>
				{
					if (pConnectError)
					{
						return fCallback(new Error(
							`MeadowConnectionManager: failed to connect "${tmpName}" (${tmpType}): ${pConnectError.message}`));
					}

					this._Connections[tmpName] =
					{
						name:     tmpName,
						hash:     tmpHash,
						type:     tmpType,
						config:   tmpConfig,
						instance: tmpInstance,
						status:   'connected',
					};
					this._ConnectionsByHash[tmpHash] = this._Connections[tmpName];

					this.log.info(`MeadowConnectionManager: connected "${tmpName}" (${tmpType}) hash=[${tmpHash}]`);
					return fCallback(null, this._Connections[tmpName]);
				});
		}
		else
		{
			this._Connections[tmpName] =
			{
				name:     tmpName,
				hash:     tmpHash,
				type:     tmpType,
				config:   tmpConfig,
				instance: tmpInstance,
				status:   'connected',
			};
			this._ConnectionsByHash[tmpHash] = this._Connections[tmpName];

			this.log.info(`MeadowConnectionManager: connected "${tmpName}" (${tmpType}) hash=[${tmpHash}]`);
			return fCallback(null, this._Connections[tmpName]);
		}
	}

	/**
	 * Disconnect a named connection.
	 *
	 * @param {string} pName
	 * @param {function} fCallback
	 */
	disconnect(pName, fCallback)
	{
		let tmpName = pName || 'default';

		if (!this._Connections[tmpName])
		{
			return fCallback(null);
		}

		let tmpConn = this._Connections[tmpName];

		// Attempt graceful close if the provider supports it
		if (tmpConn.instance && typeof tmpConn.instance.close === 'function')
		{
			tmpConn.instance.close(
				(pError) =>
				{
					if (tmpConn.hash) { delete this._ConnectionsByHash[tmpConn.hash]; }
					delete this._Connections[tmpName];
					this.log.info(`MeadowConnectionManager: disconnected "${tmpName}"`);
					return fCallback(pError);
				});
		}
		else
		{
			if (tmpConn.hash) { delete this._ConnectionsByHash[tmpConn.hash]; }
			delete this._Connections[tmpName];
			this.log.info(`MeadowConnectionManager: disconnected "${tmpName}"`);
			return fCallback(null);
		}
	}

	/**
	 * Test a connection configuration without persisting it.
	 *
	 * Connect alone is not a meaningful test for lazy-pool drivers (mysql,
	 * mysql2, node-postgres) — `createPool()` returns a pool object before
	 * any TCP socket is opened, so a misconfigured host/port/credential
	 * surfaces only on first query. Without a probe, testConnection would
	 * report success against unreachable databases and the operator only
	 * discovers the failure when introspect / a real query crashes.
	 *
	 * The probe issues a trivial round-trip per Type (SELECT 1, ping, etc.)
	 * via _probeConnection. Driver types that validate during connect
	 * (RocksDB / SQLite / MeadowEndpoints / RetoldDataBeacon) are treated as
	 * already-probed and short-circuit.
	 *
	 * @param {object} pConfig
	 * @param {function} fCallback — function(pError, pResult)
	 */
	testConnection(pConfig, fCallback)
	{
		let tmpTestName = '_test_' + Date.now();
		this.connect(tmpTestName, pConfig,
			(pError, pConnection) =>
			{
				if (pError)
				{
					return fCallback(null, { Success: false, Error: pError.message });
				}
				this._probeConnection(pConnection,
					(pProbeError) =>
					{
						this.disconnect(tmpTestName,
							() =>
							{
								if (pProbeError)
								{
									return fCallback(null, { Success: false, Error: pProbeError.message });
								}
								return fCallback(null, { Success: true });
							});
					});
			});
	}

	/**
	 * Issue a cheap round-trip against a live connection so testConnection
	 * fails when the underlying driver succeeds at pool-creation but cannot
	 * actually reach the server. Internal — not part of the public API.
	 *
	 * Per-driver probes:
	 *   MySQL / PostgreSQL          pool.query('SELECT 1')
	 *   MSSQL                       pool.request().query('SELECT 1')
	 *   SQLite                      db.prepare('SELECT 1').get()  (also opens the file lazily)
	 *   MongoDB                     db.command({ ping: 1 })
	 *   Solr                        search('*:*', { rows: 0 })  (HEAD-equivalent)
	 *   RocksDB                     no-op (file-based, opens during connect)
	 *   MeadowEndpoints             no-op (Authenticate is called during connect)
	 *   RetoldDataBeacon            no-op (handshake happens during connect)
	 *   <unknown>                   no-op (don't fail-closed on new drivers)
	 *
	 * @param {object} pConn — the entry returned by connect():
	 *                         { name, hash, type, config, instance, status }
	 * @param {function} fCallback — function(pError)  (no value on success)
	 */
	_probeConnection(pConn, fCallback)
	{
		if (!pConn || !pConn.instance) { return fCallback(null); }
		let tmpType = pConn.type;
		let tmpProvider = pConn.instance;

		try
		{
			switch (tmpType)
			{
				case 'MySQL':
				{
					let tmpPool = tmpProvider.pool || tmpProvider;
					if (!tmpPool || typeof tmpPool.query !== 'function') { return fCallback(null); }
					return tmpPool.query('SELECT 1', (pError) => fCallback(pError || null));
				}
				case 'PostgreSQL':
				{
					let tmpPool = tmpProvider.pool || tmpProvider;
					if (!tmpPool || typeof tmpPool.query !== 'function') { return fCallback(null); }
					let tmpResult = tmpPool.query('SELECT 1', (pError) => fCallback(pError || null));
					// node-postgres pools may return a Promise on newer versions when
					// no callback is honored — adopt it defensively.
					if (tmpResult && typeof tmpResult.then === 'function')
					{
						let tmpDelivered = false;
						tmpResult.then(
							() => { if (!tmpDelivered) { tmpDelivered = true; fCallback(null); } },
							(pError) => { if (!tmpDelivered) { tmpDelivered = true; fCallback(pError); } });
					}
					return;
				}
				case 'MSSQL':
				{
					let tmpPool = tmpProvider.pool || tmpProvider;
					if (!tmpPool || typeof tmpPool.request !== 'function') { return fCallback(null); }
					let tmpRequest = tmpPool.request();
					let tmpResult = tmpRequest.query('SELECT 1');
					if (tmpResult && typeof tmpResult.then === 'function')
					{
						return tmpResult.then(() => fCallback(null), (pError) => fCallback(pError));
					}
					return fCallback(null);
				}
				case 'SQLite':
				{
					let tmpDB = tmpProvider.db || tmpProvider;
					if (!tmpDB || typeof tmpDB.prepare !== 'function') { return fCallback(null); }
					tmpDB.prepare('SELECT 1').get();
					return fCallback(null);
				}
				case 'MongoDB':
				{
					let tmpDB = tmpProvider.db || tmpProvider.pool || tmpProvider;
					if (!tmpDB || typeof tmpDB.command !== 'function') { return fCallback(null); }
					let tmpResult = tmpDB.command({ ping: 1 });
					if (tmpResult && typeof tmpResult.then === 'function')
					{
						return tmpResult.then(() => fCallback(null), (pError) => fCallback(pError));
					}
					return fCallback(null);
				}
				case 'Solr':
				{
					let tmpClient = tmpProvider.pool || tmpProvider;
					if (!tmpClient || typeof tmpClient.search !== 'function') { return fCallback(null); }
					let tmpDelivered = false;
					let tmpDeliver = (pError) => { if (!tmpDelivered) { tmpDelivered = true; fCallback(pError || null); } };
					let tmpResult = tmpClient.search('q=*:*&rows=0', tmpDeliver);
					if (tmpResult && typeof tmpResult.then === 'function')
					{
						tmpResult.then(() => tmpDeliver(null), (pError) => tmpDeliver(pError));
					}
					return;
				}
				default:
					return fCallback(null);
			}
		}
		catch (pError)
		{
			return fCallback(pError);
		}
	}

	// ─────────────────────────────────────────────
	//  Queries
	// ─────────────────────────────────────────────

	/**
	 * Get a named connection.
	 * @param {string} [pName='default']
	 * @returns {object|null} — { name, hash, type, config, instance, status }
	 */
	getConnection(pName)
	{
		return this._Connections[pName || 'default'] || null;
	}

	/**
	 * Get a connection by its sanitized hash.
	 * @param {string} pHash
	 * @returns {object|null} — same shape as getConnection()
	 */
	getConnectionByHash(pHash)
	{
		return this._ConnectionsByHash[pHash] || null;
	}

	/**
	 * Get all connection names.
	 * @returns {string[]}
	 */
	getConnectionNames()
	{
		return Object.keys(this._Connections);
	}

	/**
	 * Get metadata for all connections (without instances).
	 * @returns {Array}
	 */
	listConnections()
	{
		let tmpResult = [];
		let tmpNames = Object.keys(this._Connections);
		for (let i = 0; i < tmpNames.length; i++)
		{
			let tmpConn = this._Connections[tmpNames[i]];
			tmpResult.push(
			{
				name:   tmpConn.name,
				type:   tmpConn.type,
				status: tmpConn.status,
			});
		}
		return tmpResult;
	}

	/**
	 * Check which provider modules are installed.
	 * @returns {object} — { TypeName: boolean }
	 */
	getAvailableProviders()
	{
		let tmpResult = {};
		let tmpTypes = Object.keys(PROVIDER_MODULES);
		for (let i = 0; i < tmpTypes.length; i++)
		{
			try
			{
				require.resolve(PROVIDER_MODULES[tmpTypes[i]]);
				tmpResult[tmpTypes[i]] = true;
			}
			catch (pError)
			{
				tmpResult[tmpTypes[i]] = false;
			}
		}
		return tmpResult;
	}

	// ─────────────────────────────────────────────
	//  Form schema discovery
	// ─────────────────────────────────────────────

	/**
	 * Get the connection-form schema for one provider type.
	 *
	 * The schema is the canonical description of which fields are
	 * needed to connect to a given engine — used by UIs that want to
	 * render a "Connect to <X>" form without re-encoding the field
	 * list per app.  Each provider module exports its own schema at
	 * `source/Meadow-Connection-<Type>-FormSchema.js`; this method
	 * loads it without triggering the driver `require()` so it works
	 * even when the optional peer dep isn't installed.
	 *
	 * Schema shape:
	 *   {
	 *     Provider:    'MySQL',
	 *     DisplayName: 'MySQL',
	 *     Description: '...',
	 *     Fields: [{ Name, Label, Type, Default, Required, ... }, ...]
	 *   }
	 *
	 * @param {string} pType — provider type key, e.g. 'MySQL'
	 * @returns {object|null} schema object, or null if the provider
	 *   isn't registered or its module isn't installed
	 */
	getProviderFormSchema(pType)
	{
		let tmpSchemaPath = _resolveFormSchemaPath(pType);
		if (!tmpSchemaPath) { return null; }
		try
		{
			return require(tmpSchemaPath);
		}
		catch (pError)
		{
			this.log.trace(`MCM: form schema not available for "${pType}": ${pError.message}`);
			return null;
		}
	}

	/**
	 * Get the connection-form schemas for every provider whose module
	 * is currently installed.  Returns an array of schema objects in
	 * a stable provider-type order, suitable for serializing as JSON
	 * to a browser UI that drives a provider-picker form.
	 *
	 * Providers whose module is not installed (or whose schema file
	 * is missing for any reason) are silently skipped.
	 *
	 * @returns {object[]}
	 */
	getAllProviderFormSchemas()
	{
		let tmpResult = [];
		let tmpTypes = Object.keys(PROVIDER_MODULES);
		for (let i = 0; i < tmpTypes.length; i++)
		{
			let tmpSchema = this.getProviderFormSchema(tmpTypes[i]);
			if (tmpSchema) { tmpResult.push(tmpSchema); }
		}
		return tmpResult;
	}
}

module.exports = MeadowConnectionManager;
module.exports.sanitizeConnectionName = libSanitizeConnectionName;
