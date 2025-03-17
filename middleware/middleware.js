// middleware.js - Consolidated middleware exports
const { ApiError, asyncHandler, errorMiddleware, notFoundMiddleware } = require('./errorHandling');
const configureLimiters = require('./rateLimits');
const { retryOperation, withDatabaseRetry, withNetworkRetry } = require('./retryPolicy');
const { sanitizeUserInput, sanitizeObject, sanitizeRequestBody } = require('./sanitizeRequests');

module.exports = {
    // Error handling
    ApiError,
    asyncHandler,
    errorMiddleware,
    notFoundMiddleware,

    // Rate limiters
    configureLimiters,

    // Retry policies
    retryOperation,
    withDatabaseRetry,
    withNetworkRetry,

    // Sanitization
    sanitizeUserInput,
    sanitizeObject,
    sanitizeRequestBody
};