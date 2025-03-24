// user_routes.js
const express = require('express');
const passport = require('passport');
const { validateSession }  = require('../../middleware/validateSession');
const router = express.Router();
const axios = require('axios');
const mongodb = require('../../third_party/mongodb');
const validation = require('./user_validation');
const {
    asyncHandler,
    ApiError,
    withDatabaseRetry,
    withNetworkRetry,
    configureLimiters
} = require('../../middleware/middleware');
const {getNodeBBServiceUrl} = require("../../third_party/nodebb");

// Configure rate limiters
const { accountCheckLimiter, signupLimiter, loginLimiter } = configureLimiters({
    isProduction: process.env.NODE_ENV === 'production'
});

router.get("/", validateSession, asyncHandler(async (req, res) => {
    if (!req.isAuthenticated() && !req.uid) {
        throw new ApiError("Authentication required", 401);
    }

    const userId = req.uid || req.user?.uid;

    if (!userId) {
        throw new ApiError("User ID required", 400);
    }

    try {
        const getWithRetry = withNetworkRetry(axios.get);
        const apiConfig = {
            headers: {
                Authorization: `Bearer ${process.env.NODEBB_BEARER_TOKEN}`,
                "X-CSRF-Token": req.user?.csrfToken || ""
            },
        };

        const response = await getWithRetry(
            `${getNodeBBServiceUrl()}/api/user/uid/${userId}`,
            apiConfig
        );

        if (!response.data) {
            return res.status(404).json({ error: "User not found" });
        }

        // Check if admin status needs to be updated
        const isAdmin = response.data.groupTitleArray?.includes("administrators") || false;

        if (req.user && req.user.isAdmin !== isAdmin) {
            // Only update what's needed
            req.user.isAdmin = isAdmin;
            req.login(req.user, (err) => {
                if (err) {
                    console.error("Error updating session:", err);
                }
            });
        }

        // Forward NodeBB cookies to client if they exist
        if (response.headers['set-cookie']) {
            response.headers['set-cookie'].forEach(cookie => {
                res.append('Set-Cookie', cookie);
            });
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
            `${getNodeBBServiceUrl()}/api/v3/users/`,
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

router.post("/login", loginLimiter, asyncHandler((req, res, next) => {
    // Validate the request body
    const { isValid, errors } = validation.validateLogin(req.body);

    if (!isValid) {
        throw new ApiError("Validation failed", 400, errors);
    }

    // Use Passport's authenticate method
    passport.authenticate('local', (err, user, info, nodeBBCookies) => {
        if (err) {
            console.error("Authentication error:", err);
            return next(new ApiError("Authentication error", 500));
        }

        if (!user) {
            return res.status(401).json({
                success: false,
                message: info?.message || "Invalid username or password"
            });
        }

        // Log in the user
        req.login(user, (loginErr) => {
            if (loginErr) {
                console.error("Session error:", loginErr);
                return next(new ApiError("Login error", 500));
            }

            // Forward NodeBB cookies to client
            if (req.loginCookies) {
                console.log("Forwarding NodeBB cookies:", req.loginCookies);

                // Set each cookie individually with proper options
                req.loginCookies.forEach(cookie => {
                    // The cookie string has name=value; path=/; etc.
                    // We just forward it directly
                    res.append('Set-Cookie', cookie);
                });
            } else {
                console.warn("No NodeBB cookies found to forward");
            }

            return res.json({
                success: true,
                user: {
                    uid: user.uid,
                    username: user.username,
                    email: user.email || "",
                    "email:confirmed": user["email:confirmed"] || 0,
                    groupTitle: user.groupTitle || "",
                    groupTitleArray: user.groupTitleArray || [],
                }
            });
        });
    })(req, res, next);
}));

router.post("/logout", asyncHandler(async (req, res) => {
    try {
        // First, check if user is authenticated
        if (req.isAuthenticated()) {
            // Use Passport's logout method to clear the session
            req.logout(function(err) {
                if (err) {
                    console.error("Passport logout error:", err);
                    throw new ApiError("Logout failed", 500);
                }
            });
        }

        // Destroy the session regardless of authentication state
        if (req.session) {
            req.session.destroy();
        }

        // Clear authentication cookies from client
        res.clearCookie('express.sid');
        res.clearCookie('connect.sid');

        res.status(200).json({
            success: true,
            message: "Logged out successfully from the application"
        });
    } catch (error) {
        console.error("Logout error:", error);
        throw new ApiError("Logout failed", 500);
    }
}))

module.exports = router;