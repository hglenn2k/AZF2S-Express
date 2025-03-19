// Process event handlers for proper error handling
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION! Shutting down...', err.name, err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION! Shutting down...', err.name, err.message);
  console.error(err.stack);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  const { disconnect } = require('./third_party/mongodb');

  disconnect()
      .then(() => {
        console.log('MongoDB disconnected successfully');
        process.exit(0);
      })
      .catch((err) => {
        console.error('Error during graceful shutdown:', err);
        process.exit(1);
      });
});

const express = require("express");
const passport = require("passport");
const configurePassport = require('./middleware/passport');
const session = require("express-session");
const MongoStore = require("connect-mongo");
const { google } = require("googleapis");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();
const nodemailer = require("nodemailer");
const fetch = require("node-fetch");
const dayjs = require("dayjs");
const { ObjectId } = require("mongodb");
const {notFoundMiddleware, errorMiddleware} = require("./middleware/errorHandling");
const {validateSession, validateAdminSession } = require("./middleware/validateSession");
const { sanitizeRequestBody } = require("./middleware/sanitizeRequests");
const setupLegacyRoutes = require("./routes/legacy_routes");
const app = express();
const PORT = process.env.PORT || 3001;
const mongoClient = require('./third_party/mongodb');

// Unit test middleware
console.log('Validating critical modules before startup...');
try {
  require('./tests/testMiddlewareOnStartup');
  console.log('Critical modules validated successfully');
} catch (error) {
  console.error('FATAL ERROR: Module validation failed', error);
  process.exit(1);
}

// Setup basic middleware
app.set('trust proxy', 1);
app.use(express.json());
app.use(sanitizeRequestBody);

// Improved CORS configuration - configure this before session middleware
app.use(
    cors({
      origin: process.env.REACT_APP_DOMAIN || 'http://localhost',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
    })
);

// Google Sheets API setup
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

async function startServer() {
  try {
    // Connect to MongoDB once
    await mongoClient.connect();
    console.log('MongoDB connected successfully');

    // Configure session store with the connected client
    const sessionStore = MongoStore.create({
      client: mongoClient.client,
      dbName: process.env.MONGO_ENV || 'DEV',  // Specify the database name
      collectionName: "sessions",
      stringify: false
    });

    // Configure session middleware
    app.use(
        session({
          store: sessionStore,
          secret: process.env.EXPRESS_SESSION_SECRET,
          key: "express.sid",
          resave: false,
          saveUninitialized: false,
          cookie: {
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 1000 * 60 * 60 * 24 // 24 hours
          }
        })
    );

    // Initialize Passport (after session middleware)
    app.use(passport.initialize());
    app.use(passport.session());

    // Configure Passport strategies
    configurePassport();

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

    // Register modern routes
    const user_routes = require('./routes/user/user_routes.js');
    app.use('/user/', user_routes);

    // Register legacy routes with necessary context
    setupLegacyRoutes(app, {
      jwtClient,
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
      mongoClient: mongoClient
    });

    // Add a health check endpoint
    app.get('/health', async (req, res) => {
      const mongoStatus = await mongoClient.ping();
      res.status(200).json({
        status: 'ok',
        mongo: mongoStatus,
        timestamp: new Date().toISOString()
      });
    });

    // Add a session debug endpoint
    app.get('/session-debug', (req, res) => {
      res.json({
        sessionExists: !!req.session,
        sessionID: req.sessionID || 'No session ID',
        hasPassport: req.session && !!req.session.passport,
        isAuthenticated: req.isAuthenticated && req.isAuthenticated() || false,
        user: req.user || 'No user',
        sessionData: req.session,
        cookies: req.headers.cookie
      });
    });

    // Error middlewares should be last
    app.use(notFoundMiddleware);
    app.use(errorMiddleware);

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