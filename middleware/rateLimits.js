// rateLimits.js
let rateLimit;

// Try to require express-rate-limit
try {
    rateLimit = require('express-rate-limit');
} catch (err) {
    throw new Error(`Failed to initialize rate limiting: ${err.message}. 
    Make sure express-rate-limit is installed correctly.`);
}

// Default options that can be overridden
const defaultOptions = {
    standardWindowMs: 15 * 60 * 1000, // 15 minutes
    extendedWindowMs: 60 * 60 * 1000, // 1 hour
    message: { error: 'Too many requests, please try again later' }
};

/**
 * Configure and export rate limiters for different endpoints
 * @param {Object} options - Optional configuration to override defaults
 * @returns {Object} Configured rate limiters
 */
const configureLimiters = (options = {}) => {
    const config = { ...defaultOptions, ...options };

    // For account availability checks (username/email)
    const accountCheckLimiter = rateLimit({
        windowMs: config.standardWindowMs,
        max: config.isProduction ? 10 : 30, // Less strict in development
        message: { error: 'Too many account availability checks, please try again later' },
        standardHeaders: true,
        legacyHeaders: false,
    });

    // For signup attempts
    const signupLimiter = rateLimit({
        windowMs: config.extendedWindowMs,
        max: config.isProduction ? 5 : 15, // Less strict in development
        message: { error: 'Too many signup attempts, please try again later' },
        standardHeaders: true,
        legacyHeaders: false,
    });

    // For login attempts
    const loginLimiter = rateLimit({
        windowMs: config.standardWindowMs,
        max: config.isProduction ? 5 : 20, // Less strict in development
        message: { error: 'Too many login attempts, please try again later' },
        standardHeaders: true,
        legacyHeaders: false,
    });

    // For other API endpoints
    const apiLimiter = rateLimit({
        windowMs: config.standardWindowMs,
        max: config.isProduction ? 100 : 300, // General API rate limit
        message: { error: 'Too many requests, please try again later' },
        standardHeaders: true,
        legacyHeaders: false,
    });

    // Add properties to make testing easier (without accessing the internal handler)
    accountCheckLimiter.windowMs = config.standardWindowMs;
    accountCheckLimiter.max = config.isProduction ? 10 : 30;
    accountCheckLimiter.message = config.message.error ? config.message : { error: 'Too many account availability checks, please try again later' };

    signupLimiter.windowMs = config.extendedWindowMs;
    signupLimiter.max = config.isProduction ? 5 : 15;
    signupLimiter.message = config.message.error ? config.message : { error: 'Too many signup attempts, please try again later' };

    loginLimiter.windowMs = config.standardWindowMs;
    loginLimiter.max = config.isProduction ? 5 : 20;
    loginLimiter.message = config.message.error ? config.message : { error: 'Too many login attempts, please try again later' };

    apiLimiter.windowMs = config.standardWindowMs;
    apiLimiter.max = config.isProduction ? 100 : 300;
    apiLimiter.message = config.message.error ? config.message : { error: 'Too many requests, please try again later' };

    return {
        accountCheckLimiter,
        signupLimiter,
        loginLimiter,
        apiLimiter
    };
};

module.exports = configureLimiters;