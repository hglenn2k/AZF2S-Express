const express = require('express');
const { nodeBB} = require("../../third_party/nodebb");
const mongodb = require('../../third_party/mongodb');
const { validateSession }  = require('../../middleware/validateSession');
const validation = require('./user_validation');
const router = express.Router();

router.post('/is-available', (async (req, res) => {
    try {
        const { isValid, errors } = validation.validateIsAvailable(req.body);
        if (!isValid) {
            return res.status(400).json({
                success: false,
                errors: errors
            });
        }

        const {username, email} = req.body;
        let usernameAvailable = false, emailAvailable = false;

        const collection = await mongodb.getCollection(process.env.MONGO_NODEBB_COLLECTION);

        const existingUsername = await collection.findOne({ username: username });
        if (existingUsername === null || existingUsername === undefined) { usernameAvailable = true; }
        console.log(`Found username: ${existingUsername}`);

        const existingEmail = await collection.findOne({ email: email });
        if (existingEmail === null || existingEmail === undefined) { emailAvailable = true; }
        console.log(`Found email: ${existingEmail}`);

        if (!usernameAvailable || !emailAvailable) {
            return res.status(400).json({});
        }

        return res.status(200).json({});
    } catch (error) {
        return res.status(500).json({});
    }
}));

router.get("/", validateSession, (async (req, res) => {
    try {
        const response = await nodeBB.api.get(`/api/user/username/${req.session.user.username}`,
            {
                headers: {
                    'Cookie': req.session.cookie,
                    'x-csrf-token': req.session.csrfToken,
                }
            }
        );

        if (!response.data) {
            return res.status(404).json({ error: "User not found" });
        }

        res.status(200).json(response.data);
    } catch (error) {
        if (error.response) {
            console.error("NodeBB API error:", error.response.status, error.response.data);

            if (error.response.status === 404) {
                return res.status(404).json({ error: "User not found" });
            }
        }
        else {
            console.error("Error fetching user data:", error);
        }

        return res.status(500).json({ error: "Internal Server Error" });
    }
}));

router.post("/login", (async (req, res) => {
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
            res.cookie('nodebb.sid', nodeBBSession.sessionCookie);
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
    }
}));

module.exports = router;