// MongoDB connection module
const { MongoClient } = require('mongodb');

// Get environment variables for MongoDB connection
const mongoEnv = process.env.MONGO_ENV;
const mongoURL = "mongodb+srv://" +
    process.env.EXPRESS_MONGO_USER +
    ":" +
    process.env.EXPRESS_MONGO_PASSWORD +
    "@farmtoschool.fpauuua.mongodb.net/" +
    mongoEnv;

// Create a MongoDB client with connection options
const client = new MongoClient(mongoURL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

// Track connection state
let connected = false;

// Connect to MongoDB
const connect = async () => {
    if (!connected) {
        await client.connect();
        connected = true;
    }
    return client;
};

// Get a database instance
const getDB = async () => {
    await connect();
    return client.db(mongoEnv);
};

// Get a collection from the database
const getCollection = async (collectionName) => {
    const db = await getDB();
    return db.collection(collectionName);
};

module.exports = {
    client,
    connect,
    getDB,
    getCollection,
    mongoEnv
};
/* todo
For a more robust solution in production code, you might also want to:

Add error handling for connection failures
Implement connection pooling if needed
Add timeout logic for connections
Consider implementing a reconnection strategy

Would you like me to enhance the code further with any of these improvements?
 */