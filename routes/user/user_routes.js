// user_routes.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const mongodb = require('../../third_party/mongodb');
const validation = require('./user_validation');
const {
    asyncHandler,
    ApiError,
    sanitizeRequestBody,
    withDatabaseRetry,
    withNetworkRetry,
    configureLimiters
} = require('../../middleware/middleware');

// Configure rate limiters
const { accountCheckLimiter, signupLimiter, loginLimiter } = configureLimiters({
    isProduction: process.env.NODE_ENV === 'production'
});

// Apply sanitization middleware to all routes
router.use(sanitizeRequestBody);

// Check if account is available
router.post("/is-account-available", accountCheckLimiter, asyncHandler(async (req, res) => {
    // Validate the request body
    const { isValid, errors } = validation.validateAccountAvailability(req.body);

    if (!isValid) {
        throw new ApiError("Validation failed", 400, errors);
    }

    const { username, email } = req.body;

    // Use database operation with retry
    const getCollection = withDatabaseRetry(mongodb.getCollection);

    // First verify database connection is alive
    let collection;
    try {
        collection = await getCollection("objects");

        // Perform a simple ping query to verify the database is working
        const findOne = withDatabaseRetry(collection.findOne.bind(collection));
        await findOne({ _id: "connectionTest" }, { projection: { _id: 1 }, timeout: 2000 });
    } catch (dbError) {
        console.error("Database connection error:", dbError);
        throw new ApiError("Database unavailable", 503, {
            message: "Unable to verify account availability. Please try again later."
        });
    }

    // Now proceed with the account check using retry for each database operation
    try {
        const findUser = withDatabaseRetry(collection.findOne.bind(collection));

        // Use exact key pattern for safer queries
        const userByUsername = await findUser({
            _key: { $regex: "^user:", $options: "" },
            username: username
        });

        const userByEmail = await findUser({
            _key: { $regex: "^user:", $options: "" },
            email: email
        });

        // Explicit check to make sure we got valid responses
        if (userByUsername === undefined || userByEmail === undefined) {
            throw new Error("Invalid database response");
        }

        // Check username and email separately for better error messaging
        if (userByUsername) {
            return res.status(403).json({
                message: "Username already exists",
                takenFields: { username: true, email: false }
            });
        }

        if (userByEmail) {
            return res.status(403).json({
                message: "Email already exists",
                takenFields: { username: false, email: true }
            });
        }

        // If we reach here, both are available AND we've confirmed the database is working
        res.status(200).json({ message: "Both username and email are available" });
    } catch (queryError) {
        console.error("Error querying user data:", queryError);
        throw new ApiError("Database query failed", 503, {
            message: "Unable to verify account availability. Please try again later."
        });
    }
}));

// Sign-up endpoint
router.post("/sign-up", signupLimiter, asyncHandler(async (req, res) => {
    // Validate the request body
    const { isValid, errors } = validation.validateSignUp(req.body);

    if (!isValid) {
        throw new ApiError("Validation failed", 400, errors);
    }

    const { username, password, email } = req.body;
    const _uid = 1;
    const apiConfig = {
        headers: {
            Authorization: `Bearer ${process.env.NODEBB_BEARER_TOKEN}`,
            "X-CSRF-Token": req.body.csrf || ""
        },
    };

    try {
        // Verify database connection before proceeding
        const getCollection = withDatabaseRetry(mongodb.getCollection);
        let collection;

        try {
            collection = await getCollection("objects");

            // Quick ping to verify connection
            const findOne = withDatabaseRetry(collection.findOne.bind(collection));
            await findOne({ _id: "connectionTest" }, { projection: { _id: 1 }, timeout: 2000 });
        } catch (dbError) {
            console.error("Database connection error during signup:", dbError);
            throw new ApiError("Database unavailable", 503, {
                message: "Unable to process signup. Please try again later."
            });
        }

        // Check if account is available first (double-check to prevent race conditions)
        const findOne = withDatabaseRetry(collection.findOne.bind(collection));
        let existingUser;

        try {
            existingUser = await findOne({
                _key: { $regex: "^user:", $options: "" },
                $or: [{ username: username }, { email: email }]
            });

            // Explicitly check for undefined to catch database issues
            if (existingUser === undefined) {
                throw new Error("Invalid database response");
            }
        } catch (queryError) {
            console.error("Error querying user data during signup:", queryError);
            throw new ApiError("Database query failed", 503, {
                message: "Unable to verify account availability. Please try again later."
            });
        }

        if (existingUser) {
            return res.status(403).json({
                message: "Account already exists",
                takenFields: {
                    username: existingUser.username === username,
                    email: existingUser.email === email
                }
            });
        }

        // Use network retry for making the NodeBB API request
        const postWithRetry = withNetworkRetry(axios.post);

        const response = await postWithRetry(
            `${process.env.DOMAIN}/api/nodebb/api/v3/users/`,
            { _uid, username, password, email },
            apiConfig
        );

        if (response.headers["set-cookie"]) {
            // In production, would add SameSite and Secure flags
            const cookies = response.headers["set-cookie"];
            res.setHeader("set-cookie", cookies);
        }

        // Return minimal necessary user data in response
        const userData = {
            uid: response.data.uid,
            username: response.data.username,
            // Don't return email or other sensitive fields
        };

        res.json(userData);
    } catch (error) {
        // Special handling for axios errors
        if (error.response) {
            // Remove sensitive data from error response
            const sanitizedError = {
                message: error.response.data.message || "Sign-up failed",
                code: error.response.data.code
            };

            throw new ApiError(
                "Sign-up failed",
                error.response.status || 500,
                sanitizedError
            );
        }

        // Re-throw other errors to be caught by asyncHandler
        throw error;
    }
}));

// New user endpoint
router.put("/new-user", asyncHandler(async (req, res) => {
    // Validate the request body
    const { isValid, errors } = validation.validateNewUser(req.body);

    if (!isValid) {
        throw new ApiError("Validation failed", 400, errors);
    }

    const { uid, fullname, email, receivenewsletter } = req.body;

    // Validate UID format to prevent injection
    if (!/^\d+$/.test(uid)) {
        throw new ApiError("Invalid user ID format", 400);
    }

    const userKey = `user:${uid}`;
    const updateData = {
        // Full name - already sanitized by middleware
        fullname: fullname,

        // Email address - should be already validated
        email: email,

        // Legal stuff
        agreetotos: true,
        isadult: true,

        // Newsletter
        receivenewsletter: !!receivenewsletter, // Force boolean

        // Membership
        memberstatus: "unverified",
        recentlyverified: false,

        // Audit trail
        lastUpdated: new Date(),
        lastUpdatedBy: "system" // Could be replaced with admin user if available
    };

    // Use database operations with retry
    const getCollection = withDatabaseRetry(mongodb.getCollection);

    // Verify database connection is active
    let collection;
    try {
        collection = await getCollection("objects");

        // Quick ping to verify connection
        const findOne = withDatabaseRetry(collection.findOne.bind(collection));
        await findOne({ _id: "connectionTest" }, { projection: { _id: 1 }, timeout: 2000 });
    } catch (dbError) {
        console.error("Database connection error during user update:", dbError);
        throw new ApiError("Database unavailable", 503, {
            message: "Unable to update user information. Please try again later."
        });
    }

    // First check if the user exists
    const findOne = withDatabaseRetry(collection.findOne.bind(collection));
    let userExists;

    try {
        userExists = await findOne({
            _key: userKey
        });

        // Explicitly check for undefined to catch database issues
        if (userExists === undefined) {
            throw new Error("Invalid database response");
        }
    } catch (queryError) {
        console.error("Error querying user data for update:", queryError);
        throw new ApiError("Database query failed", 503, {
            message: "Unable to verify user exists. Please try again later."
        });
    }

    if (!userExists) {
        throw new ApiError("User not found", 404);
    }

    const updateOne = withDatabaseRetry(collection.updateOne.bind(collection));
    const result = await updateOne(
        { _key: userKey },
        { $set: updateData }
    );

    if (result.matchedCount > 0) {
        // Return only necessary user data
        const updatedUser = await findOne(
            { _key: userKey },
            { projection: {
                    _key: 1,
                    fullname: 1,
                    email: 1,
                    memberstatus: 1,
                    receivenewsletter: 1
                }}
        );

        res.status(200).json({
            message: "User updated successfully",
            user: updatedUser
        });
    } else {
        throw new ApiError("User not found", 404);
    }
}));

// New user email notification
router.post("/new-user-email", asyncHandler(async (req, res) => {
    // Validate the request body
    const { isValid, errors } = validation.validateNewUserEmail(req.body);

    if (!isValid) {
        throw new ApiError("Validation failed", 400, errors);
    }

    // Inputs are already sanitized by middleware
    const fullName = req.body.fullName;
    const email = req.body.email;
    const username = req.body.username;

    // Format timestamp consistently using ISO format
    const dateTime = new Date().toISOString();

    // Check if transporter exists
    if (!req.app.locals.transporter) {
        throw new ApiError("Email service not configured", 500);
    }

    // Create a safer HTML template with proper escaping
    const htmlContent = `
    <html lang="en">
    <body>
        <h2>New User Registration</h2>
        <table style="border-collapse: collapse; width: 100%;">
            <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Name:</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">${fullName}</td>
            </tr>
            <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Username:</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">${username}</td>
            </tr>
            <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Email:</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">${email}</td>
            </tr>
            <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Timestamp:</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">${dateTime}</td>
            </tr>
        </table>
    </body>
    </html>`;

    // Use the transporter with retry
    const sendMail = withNetworkRetry(
        req.app.locals.transporter.sendMail.bind(req.app.locals.transporter)
    );

    const info = await sendMail({
        from: '"[New User]" <new-user@azfarmtoschool.org>',
        to: process.env.NOTIFICATION_EMAIL || "support@azfarmtoschool.org",
        cc: process.env.NOTIFICATION_CC || "azfarmtoschoolnetwork@gmail.com",
        subject: "New User Registered",
        html: htmlContent,
    });

    // Return minimal necessary information
    res.status(200).json({
        message: "Notification email sent",
        messageId: info.messageId
    });
}));

// Login endpoint
router.post("/login", loginLimiter, asyncHandler(async (req, res) => {
    // Validate the request body
    const { isValid, errors } = validation.validateLogin(req.body);

    if (!isValid) {
        throw new ApiError("Validation failed", 400, errors);
    }

    const { username, password } = req.body;

    try {
        // Use network retry for API call
        const postWithRetry = withNetworkRetry(axios.post);

        const response = await postWithRetry(
            `${process.env.DOMAIN}/api/nodebb/api/v3/utilities/login`,
            {
                _uid: 1,
                username: username,
                password: password,
            },
            {
                headers: {
                    "X-CSRF-Token": req.body.csrf || "",
                    Authorization: "Bearer " + process.env.NODEBB_BEARER_TOKEN,
                },
            }
        );

        // Pass cookies through as-is for localhost compatibility
        if (response.headers["set-cookie"]) {
            res.setHeader("set-cookie", response.headers["set-cookie"]);
        }

        // Use database operation with retry for audit logging
        const getCollection = withDatabaseRetry(mongodb.getCollection);
        const collection = await getCollection("loginHistory");

        const insertOne = withDatabaseRetry(collection.insertOne.bind(collection));
        await insertOne({
            username: username,
            timestamp: new Date(),
            success: true,
            ip: req.ip // Assuming IP address is available via req.ip
        });

        // Return minimal necessary data
        res.json({
            success: response.data.success,
            user: {
                uid: response.data.user.uid,
                username: response.data.user.username
                // Omit other sensitive user data
            }
        });
    } catch (error) {
        // Audit failed login with retry
        try {
            const getCollection = withDatabaseRetry(mongodb.getCollection);
            const collection = await getCollection("loginHistory");

            const insertOne = withDatabaseRetry(collection.insertOne.bind(collection));
            await insertOne({
                username: username,
                timestamp: new Date(),
                success: false,
                ip: req.ip
            });
        } catch (auditError) {
            console.error("Failed to audit login attempt:", auditError);
        }

        // Special handling for axios errors
        if (error.response) {
            throw new ApiError(
                "Login failed",
                error.response.status || 500,
                { message: "Invalid username or password" } // Generic message for security
            );
        }

        // Re-throw other errors to be caught by asyncHandler
        throw error;
    }
}));

// Add logout endpoint
router.post("/logout", asyncHandler(async (req, res) => {
    try {
        // Clear authentication cookies
        res.clearCookie('connect.sid');
        res.clearCookie('express.sid');
        // Add any other cookies your auth system might set

        res.status(200).json({ success: true, message: "Logged out successfully" });
    } catch (error) {
        throw new ApiError("Logout failed", 500);
    }
}));

module.exports = router;