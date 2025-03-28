const { ApiError } = require('../middleware/errorHandling');

/**
 * Middleware to validate if a user is authenticated
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const validateSession = (req, res, next) => {
    // Check if user is authenticated using Passport's isAuthenticated method
    if (!req.isAuthenticated() || !req.user) {
        console.log('Session validation failed: User not authenticated');
        return next(new ApiError('Authentication required', 401));
    }

    // Verify that user ID exists
    if (!req.user.uid) {
        console.log('Session validation failed: Missing user ID in session');
        return next(new ApiError('Invalid session', 401));
    }

    // Add user ID to the request for convenience in route handlers
    req.uid = req.user.uid;

    // Debug log for successful authentication
    console.log(`Session validated for user: ${req.user.username} (${req.user.uid})`);

    // Continue to the next middleware or route handler
    next();
};

/**
 * Middleware to validate if a user is authenticated and has admin privileges
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const validateAdminSession = (req, res, next) => {
    // First check if the user is authenticated
    if (!req.isAuthenticated() || !req.user) {
        console.log('Admin session validation failed: User not authenticated');
        return next(new ApiError('Authentication required', 401));
    }

    // Then check if user has admin role
    if (!req.user.isAdmin) {
        console.log(`Admin access denied for user: ${req.user.username} (${req.user.uid})`);
        return next(new ApiError('Admin privileges required', 403));
    }

    // Add user ID to the request for convenience
    req.uid = req.user.uid;

    // Debug log for successful admin authentication
    console.log(`Admin session validated for user: ${req.user.username} (${req.user.uid})`);

    // Continue to the next middleware or route handler
    next();
};

module.exports = {
    validateSession,
    validateAdminSession
};