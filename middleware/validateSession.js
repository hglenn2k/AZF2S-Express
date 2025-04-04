const { nodeBB } = require('../third_party/nodebb');

/**
 * Session validation middleware
 * Ensures user session and CSRF token are present
 */
const validateSession = async (req, res, next) => {
    // Check for user session
    if (!req.session.user) {
        return res.status(401).json({
            success: false,
            message: "No session found."
        });
    }

    // Check for CSRF token
    if (!req.session.csrfToken) {
        return res.status(401).json({
            success: false,
            message: "Could not authenticate session."
        });
    }

    next();
};

/**
 * Admin session validation middleware
 * Ensures user is authenticated and has admin privileges
 */
const validateAdminSession = async (req, res, next) => {
    // First validate basic session requirements
    if (!req.session.user) {
        return res.status(401).json({
            success: false,
            message: "No session found."
        });
    }

    if (!req.session.csrfToken) {
        return res.status(401).json({
            success: false,
            message: "Could not authenticate session."
        });
    }

    try {
        const response = await nodeBB.api.get('/api/admin/manage/admins-mods', {
            headers: {
                Cookie: req.headers.cookie
            }
        });

        const adminData = response.data;

        // Check if user is an admin
        const isAdmin = adminData.admins.members.some(
            (admin) => admin.username === req.session.user.username
        );

        if (isAdmin) {
            next();
        } else {
            res.status(403).json({
                success: false,
                error: "Could not certify administrator."
            });
        }
    } catch (error) {
        console.error('Admin session validation error:', error.message);

        if (error.response) {
            return res.status(error.response.status).json({
                success: false,
                error: "Error validating admin session.",
                details: error.response.data
            });
        } else if (error.request) {
            return res.status(504).json({
                success: false,
                error: "Server timeout while validating admin session."
            });
        } else {
            return res.status(500).json({
                success: false,
                error: "Internal error while validating admin session.",
            });
        }
    }
};

module.exports = {
    validateSession,
    validateAdminSession
};