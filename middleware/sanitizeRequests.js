/**
 * Module for sanitizing user input and request data
 * Uses sanitize-html to properly handle XSS attacks
 */
const sanitizeHtml = require('sanitize-html');

/**
 * Sanitizes user input to prevent XSS and HTML injection attacks
 * @param {string} input - User input to sanitize
 * @returns {string} - Sanitized input with all HTML stripped
 */
const sanitizeUserInput = (input) => {
    // Return empty string if input is not a string
    if (typeof input !== 'string') {
        return '';
    }

    // Use sanitize-html with strict settings - no tags allowed
    return sanitizeHtml(input, {
        allowedTags: [],
        allowedAttributes: {}
    });
};

/**
 * Sanitizes all string properties in an object
 * @param {Object} obj - Object containing user input
 * @returns {Object} - Copy of the object with sanitized string values
 */
const sanitizeObject = (obj) => {
    // If not an object or null, return as is
    if (typeof obj !== 'object' || obj === null) {
        return obj;
    }

    // Handle arrays
    if (Array.isArray(obj)) {
        return obj.map(item => {
            if (typeof item === 'string') {
                return sanitizeUserInput(item);
            }
            return sanitizeObject(item);
        });
    }

    // Create a copy to avoid modifying the original
    const sanitized = {};

    // Recursively sanitize all string properties
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            if (typeof obj[key] === 'string') {
                sanitized[key] = sanitizeUserInput(obj[key]);
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                sanitized[key] = sanitizeObject(obj[key]);
            } else {
                sanitized[key] = obj[key];
            }
        }
    }

    return sanitized;
};

/**
 * Express middleware to sanitize request body
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const sanitizeRequestBody = (req, res, next) => {
    if (req.body && typeof req.body === 'object') {
        req.body = sanitizeObject(req.body);
    }
    next();
};

module.exports = {
    sanitizeUserInput,
    sanitizeObject,
    sanitizeRequestBody
};