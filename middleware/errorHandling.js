// errorHandling.js - Centralized error handling for API routes

/**
 * Custom API error class with status code
 */
class ApiError extends Error {
    constructor(message, statusCode = 500, details = null) {
        super(message);
        this.statusCode = statusCode;
        this.details = details;
        this.name = 'ApiError';
    }
}

/**
 * Async handler wrapper to avoid try-catch blocks in route handlers
 * @param {Function} fn - Route handler function
 * @returns {Function} - Enhanced route handler with error handling
 */
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Global error handling middleware
 */
const errorMiddleware = (err, req, res) => {
    console.error('API Error:', err);

    // Default error values
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal Server Error';

    // Specific error handling for MongoDB errors
    if (err.name === 'MongoServerError' || err.name === 'MongoError') {
        // Handle specific MongoDB errors with useful messages
        if (err.code === 18) {
            return res.status(500).json({
                success: false,
                message: 'Authentication failed with the database',
                error: 'Database credentials are invalid or missing'
            });
        }

        if (err.code === 13) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions to access the database',
                error: 'Database permission error'
            });
        }
    }

    // Connection errors
    if (err.message.includes('Failed to connect to MongoDB')) {
        return res.status(503).json({
            success: false,
            message: 'Database connection error',
            error: 'Cannot connect to database. Please try again later.'
        });
    }

    // Configuration errors
    if (err.message.includes('missing in configuration')) {
        return res.status(500).json({
            success: false,
            message: 'Server configuration error',
            error: 'Application is not configured correctly. Please contact support.'
        });
    }

    // Generic error response
    res.status(statusCode).json({
        success: false,
        message,
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
        ...(err.details && { details: err.details })
    });
};

/**
 * Not found middleware for undefined routes
 */
const notFoundMiddleware = (req, res) => {
    res.status(404).json({
        success: false,
        message: `Not Found - ${req.originalUrl}`
    });
};

module.exports = {
    ApiError,
    asyncHandler,
    errorMiddleware,
    notFoundMiddleware
};