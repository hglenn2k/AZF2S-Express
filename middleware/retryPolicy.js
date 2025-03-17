// middleware/retryPolicy.js
const { MongoClient } = require('mongodb');

// Configuration - Detect environment and set appropriate variables
const ENVIRONMENTS = {
    development: 'development',
    test: 'test',
    production: 'production'
};

// Cache for configuration
let configCache = null;

// Get environment variables for MongoDB connection
const getConfig = () => {
    // Return cached config if available
    if (configCache) return configCache;

    // Get environment
    const mongoEnv = process.env.MONGO_ENV || ENVIRONMENTS.development;

    // Determine connection type
    const connectionType = (process.env.MONGO_CONNECTION_TYPE || 'atlas').toLowerCase();

    // MongoDB configuration based on connection type
    let config = {
        user: process.env.MONGO_USER,
        password: process.env.MONGO_PASSWORD,
        database: mongoEnv,
        connectionType
    };

    // Add specific configuration based on connection type
    switch (connectionType) {
        case 'local':
            // Local or Docker container setup
            config.host = process.env.MONGO_HOST || 'mongodb';
            config.port = process.env.MONGO_PORT || '27017';
            break;

        case 'azure':
            // Azure Cosmos DB configuration
            config.host = process.env.AZURE_COSMOS_DB_HOST || 'your-cosmos-db-name.mongo.cosmos.azure.com';
            config.port = process.env.AZURE_COSMOS_DB_PORT || '10255';
            config.options = '?ssl=true&retrywrites=false&maxIdleTimeMS=120000';
            break;

        case 'atlas':
        default:
            // MongoDB Atlas configuration (default)
            config.host = process.env.MONGO_ATLAS_HOST || 'farmtoschool.fpauuua.mongodb.net';
            break;
    }

    // Verify required parameters
    const missingParams = [];

    if (!config.user) missingParams.push('MongoDB username');
    if (!config.password) missingParams.push('MongoDB password');
    if (!config.host) missingParams.push('MongoDB host');
    if (!config.database) missingParams.push('MongoDB database name');

    if (missingParams.length > 0) {
        const errorMsg = `Missing required MongoDB parameters: ${missingParams.join(', ')}`;
        console.error(errorMsg);
        throw new Error(errorMsg);
    }

    // Cache the config
    const useAzure = connectionType === 'azure';
    configCache = { config, useAzure, mongoEnv };
    return configCache;
};

// Build the MongoDB connection URL
const getMongoURL = () => {
    try {
        const { config } = getConfig();

        // Default Docker container MongoDB URL
        let url = `mongodb://${config.host}:${config.port}/${config.database}`;

        // Add authentication if provided
        if (config.user && config.password) {
            url = `mongodb://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`;
        }

        // Support for Azure Cosmos DB if needed in the future
        if (config.useAzure === true) {
            // This would need proper environment variables and configuration
            // Left as a placeholder for future implementation
            console.warn('Azure Cosmos DB support is configured but not fully implemented');
        }

        return url;
    } catch (error) {
        console.error('Failed to build MongoDB URL:', error.message);
        throw error;
    }
};

/**
 * Retries an operation with exponential backoff
 *
 * @param {Function} operation - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retry attempts
 * @param {number} options.initialDelay - Initial delay in ms
 * @param {number} options.factor - Exponential backoff factor
 * @returns {Promise<*>} - Result from the operation
 */
async function retryOperation(operation, options = {}) {
    const maxRetries = options.maxRetries || 3;
    const initialDelay = options.initialDelay || 1000;
    const factor = options.factor || 2;

    let lastError;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            attempt++;

            if (attempt >= maxRetries) {
                break;
            }

            // Calculate delay with exponential backoff
            const delay = initialDelay * Math.pow(factor, attempt - 1);

            // Wait before next retry
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // If we've exhausted all retries, throw the last error
    throw lastError;
}

/**
 * Creates a function that wraps a database operation with retry logic
 *
 * @param {Function} dbOperation - Database operation to wrap
 * @param {Object} options - Retry options
 * @returns {Function} - Wrapped function with retry logic
 */
function withDatabaseRetry(dbOperation, options = {}) {
    return async (...args) => {
        const retryOptions = {
            maxRetries: options.maxRetries || 3,
            initialDelay: options.initialDelay || 500,
            factor: options.factor || 1.5
        };

        return retryOperation(() => dbOperation(...args), retryOptions);
    };
}

/**
 * Creates a function that wraps a network operation with retry logic
 *
 * @param {Function} networkOperation - Network operation to wrap
 * @param {Object} options - Retry options
 * @returns {Function} - Wrapped function with retry logic
 */
function withNetworkRetry(networkOperation, options = {}) {
    return async (...args) => {
        const retryOptions = {
            maxRetries: options.maxRetries || 3,
            initialDelay: options.initialDelay || 200,
            factor: options.factor || 2
        };

        return retryOperation(() => networkOperation(...args), retryOptions);
    };
}

// Connection options
const connectionOptions = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,   // 5 seconds timeout for server selection
    connectTimeoutMS: 10000,          // 10 seconds connection timeout
    socketTimeoutMS: 45000            // 45 seconds socket timeout
};

// Connection retry settings
const RETRY = {
    MAX_ATTEMPTS: 3,
    INITIAL_BACKOFF_MS: 1000,
    MAX_BACKOFF_MS: 10000
};

// Create MongoDB client and connection
let client;
let connected = false;
let db;
let lastError = null;

// Initialization - called at startup
const initialize = () => {
    try {
        const mongoURL = getMongoURL();
        client = new MongoClient(mongoURL, connectionOptions);
        console.log('MongoDB client initialized');
        return true;
    } catch (error) {
        lastError = error;
        console.error('MongoDB client initialization failed:', error);
        return false;
    }
};

// Connect to MongoDB with retry
const connect = async () => {
    if (!client) {
        if (!initialize()) {
            throw new Error(`Cannot initialize MongoDB client: ${lastError?.message}`);
        }
    }

    if (connected && db) {
        return client;
    }

    let attempts = 0;
    let backoff = RETRY.INITIAL_BACKOFF_MS;
    const { config } = getConfig();

    while (attempts < RETRY.MAX_ATTEMPTS) {
        try {
            await client.connect();
            connected = true;

            // Get database
            db = client.db(config.database);

            console.log(`Connected to MongoDB database '${config.database}'`);
            return client;
        } catch (error) {
            attempts++;
            lastError = error;

            if (attempts >= RETRY.MAX_ATTEMPTS) {
                console.error(`Failed to connect to MongoDB after ${RETRY.MAX_ATTEMPTS} attempts:`, error.message);
                throw new Error(`Failed to connect to MongoDB: ${error.message}`);
            }

            console.warn(`MongoDB connection attempt ${attempts} failed. Retrying in ${backoff}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoff));

            // Exponential backoff with jitter
            backoff = Math.min(
                RETRY.MAX_BACKOFF_MS,
                backoff * 2 * (0.9 + Math.random() * 0.2)
            );
        }
    }
};

// Get database instance
const getDB = async () => {
    if (!connected || !db) {
        await connect();
    }
    return db;
};

// Get collection with error handling and retry
const getCollection = async (collectionName) => {
    if (!collectionName) {
        throw new Error('Collection name is required');
    }

    try {
        const database = await getDB();
        const collection = database.collection(collectionName);

        // Verify collection access with a simple operation
        await collection.stats();

        return collection;
    } catch (error) {
        console.error(`Error accessing collection '${collectionName}':`, error.message);

        // Specific error for authentication issues
        if (error.message.includes('Authentication failed') ||
            error.message.includes('not authorized') ||
            error.code === 18) {
            throw new Error(`Authentication failed for collection '${collectionName}': ${error.message}`);
        }

        // Handle connection issues
        if (error.message.includes('failed to connect') ||
            error.message.includes('connection closed') ||
            error.message.includes('getaddrinfo')) {

            // Reset connection status and try to reconnect
            connected = false;
            db = null;

            try {
                await connect();
                const database = await getDB();
                return database.collection(collectionName);
            } catch (reconnectError) {
                throw new Error(`Failed to reconnect to MongoDB: ${reconnectError.message}`);
            }
        }

        throw new Error(`Failed to get collection '${collectionName}': ${error.message}`);
    }
};

// Disconnect from MongoDB
const disconnect = async () => {
    if (client && connected) {
        try {
            await client.close();
            connected = false;
            db = null;
            console.log('Disconnected from MongoDB');
        } catch (error) {
            console.error('Error disconnecting from MongoDB:', error.message);
            throw new Error(`Failed to disconnect from MongoDB: ${error.message}`);
        }
    }
};

// Check MongoDB connection health
const ping = async () => {
    try {
        const database = await getDB();
        const result = await database.command({ ping: 1 });
        return result?.ok === 1;
    } catch (error) {
        console.error('MongoDB ping failed:', error.message);
        return false;
    }
};

// Method to reset the config cache (useful for testing)
const resetConfig = () => {
    configCache = null;
};

// Export the MongoDB client interface
module.exports = {
    client,
    connect,
    getDB,
    getCollection,
    disconnect,
    ping,
    resetConfig,
    retryOperation,
    withDatabaseRetry,
    withNetworkRetry,
    // More efficient getter that uses cached config
    get mongoEnv() {
        return getConfig().mongoEnv;
    },
    // Connection status for diagnostics
    get status() {
        const config = configCache || { mongoEnv: null };
        return {
            initialized: !!client,
            connected,
            environment: config.mongoEnv,
            host: config?.config?.host || 'unknown',
            lastError: lastError ? {
                message: lastError.message,
                code: lastError.code,
                time: new Date().toISOString()
            } : null
        };
    }
};

// Initialize at module load time
initialize();