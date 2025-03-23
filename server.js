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
const nodeBB = require('./third_party/nodebb');

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

    // Aggregate health check endpoint
    app.get('/health', async (req, res) => {
      try {
        const [mongoStatus, nodeBBStatus, sessionStatus] = await Promise.all([
          mongoClient.ping(),
          nodeBB.verifyNodeBBHealth(),
          getSessionHealth(req)
        ]);

        const hasErrors = !mongoStatus ||
            nodeBBStatus.status === 'error' ||
            sessionStatus.status === 'error';

        const httpStatus = hasErrors ? 503 : 200;

        res.status(httpStatus).json({
          status: hasErrors ? 'error' : 'ok',
          services: {
            mongodb: mongoStatus,
            nodebb: nodeBBStatus,
            session: sessionStatus
          },
          environment: {
            node_env: process.env.NODE_ENV,
            domain: process.env.DOMAIN
          },
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(503).json({
          status: 'error',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    // MongoDB health check
    app.get('/health/mongodb', async (req, res) => {
      try {
        const status = await mongoClient.ping();
        res.status(200).json({
          service: 'mongodb',
          status: status ? 'ok' : 'error',
          details: {
            connected: !!mongoClient.client,
            database: process.env.MONGO_ENV || 'DEV'
          },
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(503).json({
          service: 'mongodb',
          status: 'error',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    // NodeBB health check
    app.get('/health/nodebb', async (req, res) => {
      try {
        const status = await nodeBB.verifyNodeBBHealth();
        res.status(200).json({
          service: 'nodebb',
          ...status
        });
      } catch (error) {
        res.status(503).json({
          service: 'nodebb',
          status: 'error',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    // Session health check
    app.get('/health/session', (req, res) => {
      try {
        const status = getSessionHealth(req);
        res.status(200).json({
          service: 'session',
          ...status
        });
      } catch (error) {
        res.status(503).json({
          service: 'session',
          status: 'error',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    function getSessionHealth(req) {
      return {
        status: 'ok',
        details: {
          session: {
            exists: !!req.session,
            id: req.sessionID || null,
            cookie: req.session?.cookie ? {
              maxAge: req.session.cookie.maxAge,
              expires: req.session.cookie.expires,
              secure: req.session.cookie.secure,
              httpOnly: req.session.cookie.httpOnly
            } : null
          },
          authentication: {
            hasPassport: req.session && !!req.session.passport,
            isAuthenticated: req.isAuthenticated && req.isAuthenticated() || false
          },
          headers: {
            hasCookie: !!req.headers.cookie,
            hasCSRF: !!req.headers['x-csrf-token']
          }
        },
        timestamp: new Date().toISOString()
      };
    }

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