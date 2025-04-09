require("axios");

const express = require("express");
const app = express();
const PORT = process.env.PORT || 3001;
app.set('trust proxy', 1);
app.use(express.json());

const cors = require("cors");
app.use(
    cors({
      origin: process.env.PROTOCOL + process.env.DOMAIN || 'http://localhost',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
    })
);

const session = require("express-session");
const MongoStore = require("connect-mongo");

const mongoClient = require('./third_party/mongodb');
const { nodeBB } = require('./third_party/nodebb');

// Google
const { google } = require("googleapis");
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const RANGE = "Address Delimiter";
const credentials = {
  type: process.env.GOOGLE_SERVICE_ACCOUNT_TYPE,
  project_id: process.env.GOOGLE_SERVICE_ACCOUNT_PROJECT_ID,
  private_key_id: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_ID,
  private_key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, // remove all '\n' from key file when setting up env
  client_email: process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL,
  client_id: process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_ID,
  auth_uri: process.env.GOOGLE_SERVICE_ACCOUNT_AUTH_URI,
  token_uri: process.env.GOOGLE_SERVICE_ACCOUNT_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.GOOGLE_SERVICE_ACCOUNT_AUTH_PROVIDER_CERT_URL,
  client_x509_cert_url: process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_CERT_URL
};
const jwtClient = new google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key,
    ["https://www.googleapis.com/auth/spreadsheets"],
    null
);

const nodemailer = require("nodemailer");

require("dotenv").config();
require("dayjs");
const setupLegacyRoutes = require("./routes/legacy_routes");

async function startServer() {
  try {
    // Connect to MongoDB once
    await mongoClient.connect();
    console.log('MongoDB connected successfully');

    // Configure session store with the connected client
    const sessionStore = MongoStore.create({
      client: mongoClient.client,
      dbName: process.env.MONGO_NODEBB_DATABASE || 'nodebb',
      collectionName: "sessions",
      stringify: false,
      autoRemove: 'native', // Use MongoDB's TTL index
      ttl: 24 * 60 * 60, // 1 day in seconds
      touchAfter: 10 * 60, // Only update session if 10 minutes passed
      crypto: {
        secret: process.env.SESSION_COOKIE_SECRET // Encrypt session data
      }
    });

    // Configure session
    app.use(
        session({
          store: sessionStore,
          secret: process.env.SESSION_COOKIE_SECRET,
          key: 'server.sid', // Match NodeBB's cookie name
          resave: false,
          saveUninitialized: false, // Prevent Express from creating empty session
          unset: 'destroy'
        })
    );

    // Setup email transporter
    app.locals.transporter = nodemailer.createTransport({
      host: process.env.BREVO_SMTP_SERVER,
      port: process.env.BREVO_PORT,
      secure: false,
      auth: {
        user: process.env.BREVO_SMTP_LOGIN,
        pass: process.env.BREVO_SMTP_PASSWORD,
      },
    });

    app.use(`/forward/nodebb`, nodeBB.createProxyRouter()); // NodeBB proxy routes
    const user_routes = require('./routes/user/user_routes.js');
    app.use('/user/', user_routes);

    // Register legacy routes with necessary context
    setupLegacyRoutes(app, {
      jwtClient,
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
      mongoClient: mongoClient
    });

    // Start the server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();