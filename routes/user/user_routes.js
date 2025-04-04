// user_routes.js
const express = require('express');
const { validateSession }  = require('../../middleware/validateSession');
const router = express.Router();
const mongodb = require('../../third_party/mongodb');
const validation = require('./user_validation');
const {
    asyncHandler,
    ApiError,
    withDatabaseRetry,
    withNetworkRetry,
    configureLimiters
} = require('../../middleware/middleware');
const { nodeBB} = require("../../third_party/nodebb");

// Configure rate limiters
const { accountCheckLimiter, signupLimiter, loginLimiter } = configureLimiters({
    isProduction: process.env.NODE_ENV === 'production'
});

router.get("/", validateSession, asyncHandler(async (req, res) => {
    try {
        const response = await nodeBB.api.get(`/api/user/username/${req.session.user.username}`);

        if (!response.data) {
            return res.status(404).json({ error: "User not found" });
        }

        // Return all fields from NodeBB's response
        res.status(200).json(response.data);
    } catch (error) {
        // Error handling as before
        if (error.response) {
            console.error("NodeBB API error:", error.response.status, error.response.data);

            if (error.response.status === 404) {
                return res.status(404).json({ error: "User not found" });
            }

            throw new ApiError(
                "Failed to fetch user data",
                error.response.status || 500,
                { message: "Unable to fetch user data. Please try again later." }
            );
        }

        console.error("Error fetching user data:", error);
        throw new ApiError("Service unavailable", 503, {
            message: "Unable to fetch user data. Please try again later."
        });
    }
}));

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

        const response = await nodeBB.makeRequest('post', `/api/v3/users`,
            { _uid, username, password, email });

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

router.post("/login", loginLimiter, asyncHandler(async (req, res, next) => {
    // Validate request
    const { isValid, errors } = validation.validateLogin(req.body);
    if (!isValid) {
        return res.status(400).json({
            success: false,
            errors: errors
        });
    }

    try {
        // Directly authenticate with NodeBB
        const { username, password } = req.body;
        const nodeBBSession = await nodeBB.initializeNodeBBSession(username, password);

        if (!nodeBBSession.success) {
            return res.status(401).json({
                success: false,
                message: "Invalid username or password"
            });
        }

        // Set the NodeBB session cookie in the response
        if (nodeBBSession.sessionCookie) {
            res.setHeader('Set-Cookie', nodeBBSession.sessionCookie);
        }

        // Format response
        const userData = nodeBBSession.userData;
        const user = {
            uid: userData.uid,
            username: userData.username,
            validEmail: userData["email:confirmed"] === 1,
        };

        // Update session
        req.session.user = user;
        req.session.csrfToken = nodeBBSession.csrfToken;

        // Respond with user data to client
        return res.json({
            success: true,
            user: {
                uid: user.uid,
                username: user.username,
                validEmail: user.validEmail,
            }
        });
    } catch (error) {
        console.error("Authentication error:", error);
        return next(new ApiError("Authentication error", 500));
    }
}));

router.post("/logout", asyncHandler(async (req, res) => {
    // todo
}))

module.exports = router;