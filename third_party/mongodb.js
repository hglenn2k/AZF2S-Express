// third_party/mongodb.js
const { MongoClient } = require('mongodb');
require('dotenv').config();

// Build the connection string based on environment variables
let uri;

if (process.env.MONGO_URI) {
    // Use direct URI if provided
    uri = process.env.MONGO_URI;
} else if (process.env.MONGO_LOCAL === 'true') {
    // Local MongoDB (handles auth if credentials exist)
    const host = process.env.MONGO_HOST || 'localhost';
    const port = process.env.MONGO_PORT || '27017';
    const user = process.env.MONGO_USERNAME || process.env.EXPRESS_MONGO_USER || process.env.MONGO_USER;
    const password = process.env.MONGO_PASSWORD || process.env.EXPRESS_MONGO_PASSWORD;

    if (user && password) {
        uri = `mongodb://${user}:${password}@${host}:${port}`;
    } else {
        uri = `mongodb://${host}:${port}`;
    }
} else {
    // MongoDB Atlas URI construction
    const user = process.env.MONGO_USERNAME || process.env.EXPRESS_MONGO_USER || process.env.MONGO_USER;
    const password = process.env.MONGO_PASSWORD || process.env.EXPRESS_MONGO_PASSWORD;
    const host = process.env.MONGO_HOST || 'cluster0.example.mongodb.net';

    if (user && password) {
        uri = `mongodb+srv://${user}:${password}@${host}`;
    } else {
        throw new Error('MongoDB Atlas connection requires username and password');
    }
}

console.log(`MongoDB URI: ${uri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')}`);

const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,

});

let connected = false;
let db;

async function connect() {
    if (!connected) {
        await client.connect();
        connected = true;
        db = client.db(process.env.MONGO_NODEBB_DATABASE || 'nodebb');
        console.log(`Connected to MongoDB database '${db.databaseName}'`);
    }
    return client;
}

async function disconnect() {
    if (connected) {
        await client.close();
        connected = false;
        console.log('Disconnected from MongoDB');
    }
}

async function getCollection(name) {
    await connect();
    return db.collection(name);
}

async function ping() {
    try {
        await connect();
        await db.command({ ping: 1 });
        return true;
    } catch (error) {
        console.error('MongoDB ping failed:', error);
        return false;
    }
}

module.exports = {
    client,
    connect,
    disconnect,
    getCollection,
    ping
};