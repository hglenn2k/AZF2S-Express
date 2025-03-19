const { ApiError } = require('../../middleware/errorHandling');

/**
 * Middleware to validate if a user is authenticated
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const validateSession = (req, res, next) => {
    // Check if user is authenticated using Passport's isAuthenticated method
    if (!req.isAuthenticated()) {
        return next(new ApiError('Authentication required', 401));
    }

    // Add user ID to the request for convenience in route handlers
    req.uid = req.user.uid;

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
    if (!req.isAuthenticated()) {
        return next(new ApiError('Authentication required', 401));
    }

    // Then check if user has admin role
    // This would depend on how you store admin status in your user object
    if (!req.user.isAdmin) {
        return next(new ApiError('Admin privileges required', 403));
    }

    // Add user ID to the request for convenience
    req.uid = req.user.uid;

    // Continue to the next middleware or route handler
    next();
};

module.exports = {
    validateSession,
    validateAdminSession
};