// mongodb.js - Fixed MongoDB client for third-party integration
const { MongoClient } = require('mongodb');

// Configuration - Detect environment and set appropriate variables
const ENVIRONMENTS = {
    development: 'development',
    test: 'test',
    production: 'production'
};

// Get environment variables for MongoDB connection
const getConfig = () => {
    // Get environment
    const mongoEnv = process.env.MONGO_ENV || ENVIRONMENTS.development;

    // Determine connection source (Azure vs local)
    const useAzure = process.env.USE_AZURE_MONGODB === 'true';

    // Azure Cosmos DB configuration
    const azureConfig = {
        user: process.env.AZURE_COSMOS_DB_USER,
        password: process.env.AZURE_COSMOS_DB_PASSWORD,
        host: process.env.AZURE_COSMOS_DB_HOST || 'your-cosmos-db-name.mongo.cosmos.azure.com',
        port: process.env.AZURE_COSMOS_DB_PORT || '10255',
        database: process.env.AZURE_COSMOS_DB_DATABASE || mongoEnv,
        options: '?ssl=true&retrywrites=false&maxIdleTimeMS=120000'
    };

    // Express MongoDB configuration (local or container)
    const expressConfig = {
        user: process.env.EXPRESS_MONGO_USER || process.env.MONGO_USER,
        password: process.env.EXPRESS_MONGO_PASSWORD || process.env.MONGO_PASSWORD,
        host: process.env.EXPRESS_MONGO_HOST || 'farmtoschool.fpauuua.mongodb.net',
        database: process.env.EXPRESS_MONGO_DATABASE || mongoEnv
    };

    // Choose configuration based on environment
    const config = useAzure ? azureConfig : expressConfig;

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

    return { config, useAzure, mongoEnv };
};

// Build the MongoDB connection URL
const getMongoURL = () => {
    try {
        const { config, useAzure } = getConfig();

        // Build URL based on configuration type
        if (useAzure) {
            return `mongodb://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}${config.options}`;
        } else {
            // Ensure we're using the correct format for MongoDB Atlas connection
            return `mongodb+srv://${config.user}:${config.password}@${config.host}/${config.database}`;
        }
    } catch (error) {
        console.error('Failed to build MongoDB URL:', error.message);
        throw error;
    }
};

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
        // Debug log to check the actual URL
        console.log('MongoDB URL:', mongoURL.replace(/\/\/.*:.*@/, '//***:***@')); // Log URL with credentials masked
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

    while (attempts < RETRY.MAX_ATTEMPTS) {
        try {
            await client.connect();
            connected = true;

            // Get database
            const { config } = getConfig();
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

// Export the MongoDB client interface
module.exports = {
    client,
    connect,
    getDB,
    getCollection,
    disconnect,
    ping,
    get mongoEnv() {
        return getConfig().mongoEnv;
    },
    // Connection status for diagnostics
    get status() {
        return {
            initialized: !!client,
            connected,
            environment: getConfig().mongoEnv,
            usingAzure: getConfig().useAzure,
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