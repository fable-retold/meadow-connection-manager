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
	'RetoldDataBeacon': 'meadow-connection-retold-databeacon',
};

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

		// Named connections: { name: { provider, config, instance, status } }
		this._Connections = {};
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
						type:     tmpType,
						config:   tmpConfig,
						instance: tmpInstance,
						status:   'connected',
					};

					this.log.info(`MeadowConnectionManager: connected "${tmpName}" (${tmpType})`);
					return fCallback(null, this._Connections[tmpName]);
				});
		}
		else
		{
			this._Connections[tmpName] =
			{
				name:     tmpName,
				type:     tmpType,
				config:   tmpConfig,
				instance: tmpInstance,
				status:   'connected',
			};

			this.log.info(`MeadowConnectionManager: connected "${tmpName}" (${tmpType})`);
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
					delete this._Connections[tmpName];
					this.log.info(`MeadowConnectionManager: disconnected "${tmpName}"`);
					return fCallback(pError);
				});
		}
		else
		{
			delete this._Connections[tmpName];
			this.log.info(`MeadowConnectionManager: disconnected "${tmpName}"`);
			return fCallback(null);
		}
	}

	/**
	 * Test a connection configuration without persisting it.
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
				this.disconnect(tmpTestName,
					() =>
					{
						return fCallback(null, { Success: true });
					});
			});
	}

	// ─────────────────────────────────────────────
	//  Queries
	// ─────────────────────────────────────────────

	/**
	 * Get a named connection.
	 * @param {string} [pName='default']
	 * @returns {object|null} — { name, type, config, instance, status }
	 */
	getConnection(pName)
	{
		return this._Connections[pName || 'default'] || null;
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
}

module.exports = MeadowConnectionManager;
