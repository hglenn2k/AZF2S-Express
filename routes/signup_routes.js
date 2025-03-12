// signup_routes.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { ObjectId } = require('mongodb');
const mongodb = require('../third_party/mongodb');
const validation = require('../validation/signup_validation');

// Check if account is available
router.post("/is-account-available", async (req, res) => {
    // Validate the request body
    const { isValid, errors } = validation.validateAccountAvailability(req.body);

    if (!isValid) {
        return res.status(400).json({
            message: "Validation failed",
            errors
        });
    }

    const { username, email } = req.body;

    try {
        const collection = await mongodb.getCollection("objects");

        // Search for the user account by username with _key that starts with "user:"
        const userByUsername = await collection.findOne({ _key: /^user:/, username: username });

        // Search for the user account by email with _key that starts with "user:"
        const userByEmail = await collection.findOne({ _key: /^user:/, email: email });

        // If either the username or email is found, the account is already taken
        if (userByUsername || userByEmail) {
            const takenFields = {
                username: !!userByUsername,
                email: !!userByEmail
            };

            res.status(403).json({
                message: "Username or email already exists",
                takenFields
            });
        } else {
            res.status(200).json({ message: "Both username and email are available" });
        }
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Error checking account availability" });
    }
});

// Sign-up endpoint
router.post("/sign-up", async (req, res) => {
    // Validate the request body
    const { isValid, errors } = validation.validateSignUp(req.body);

    if (!isValid) {
        return res.status(400).json({
            message: "Validation failed",
            errors
        });
    }

    const { username, password, email } = req.body;
    const _uid = 1;
    const apiConfig = {
        headers: { Authorization: `Bearer ${process.env.NODEBB_BEARER_TOKEN}` },
    };

    try {
        const response = await axios.post(
            `${process.env.DOMAIN}/forum-api/api/v3/users/`,
            { _uid, username, password, email },
            apiConfig
        );

        if (response.headers["set-cookie"]) {
            res.setHeader("set-cookie", response.headers["set-cookie"]);
        }

        res.json(response.data);
    } catch (error) {
        console.error("Error during sign-up:", error.response?.data || error.message);

        if (error.response?.data) {
            return res.status(error.response.status || 500).json({
                error: "Sign-up failed",
                details: error.response.data
            });
        }

        res.status(500).json({ error: "Internal server error during sign-up" });
    }
});

// New user endpoint
router.put("/new-user", async (req, res) => {
    // Validate the request body
    const { isValid, errors } = validation.validateNewUser(req.body);

    if (!isValid) {
        return res.status(400).json({
            message: "Validation failed",
            errors
        });
    }

    const { uid, fullname, email, receivenewsletter } = req.body;
    const userKey = `user:${uid}`;
    const updateData = {
        // Full name
        fullname: fullname,

        // Email address
        email: email,

        // Legal stuff
        agreetotos: true,
        isadult: true,

        // Newsletter
        receivenewsletter: receivenewsletter || false,

        // Membership
        memberstatus: "unverified",
        recentlyverified: false,
    };

    try {
        const collection = await mongodb.getCollection("objects");

        const result = await collection.updateOne(
            { _key: userKey },
            { $set: updateData }
        );

        if (result.matchedCount > 0) {
            const updatedUser = await collection.findOne({ _key: userKey });
            res
                .status(200)
                .json({ message: "User updated successfully", user: updatedUser });
        } else {
            res.status(404).json({ message: "User not found" });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error updating user" });
    }
});

// New user email notification
router.post("/new-user-email", async (req, res) => {
    // Validate the request body
    const { isValid, errors } = validation.validateNewUserEmail(req.body);

    if (!isValid) {
        return res.status(400).json({
            message: "Validation failed",
            errors
        });
    }

    const { fullName, email, username } = req.body;

    let current = new Date();
    let cDate =
        current.getFullYear() +
        "-" +
        (current.getMonth() + 1) +
        "-" +
        current.getDate();
    let cTime =
        current.getHours() +
        ":" +
        current.getMinutes() +
        ":" +
        current.getSeconds();
    let dateTime = cDate + " " + cTime + " UTC";

    try {
        // Use the transporter from the main file (passed in via app.locals)
        let info = await req.app.locals.transporter.sendMail({
            from: '"[New User]" <new-user@azfarmtoschool.org>',
            to: "support@azfarmtoschool.org",
            cc: "azfarmtoschoolnetwork@gmail.com",
            subject: "New User Registered",
            html:
                "<html><body><br><table style='border:0; vertical-align:top;'><tr><td valign='top'><strong>Name: </strong></td><td>" +
                fullName +
                "</td></tr><tr><td valign='top'><strong>Username: </strong></td><td>" +
                username +
                "</td></tr><tr><td  valign='top'><strong>Email: </strong></td><td>" +
                email +
                "</td></tr><tr><td  valign='top'><strong>Timestamp: </strong></td><td>" +
                dateTime +
                " UTC</td></tr></table></body></html>",
        });

        res.send(info);
    } catch (error) {
        console.error("Error sending email:", error);
        res.status(500).json({ message: "Error sending notification email" });
    }
});

// Login endpoint
router.post("/login", async (req, res) => {
    // Validate the request body
    const { isValid, errors } = validation.validateLogin(req.body);

    if (!isValid) {
        return res.status(400).json({
            message: "Validation failed",
            errors
        });
    }

    const { username, password, csrf } = req.body;

    try {
        const response = await axios.post(
            `${process.env.DOMAIN}/forum-api/api/v3/utilities/login`,
            {
                _uid: 1,
                username: username,
                password: password,
            },
            {
                headers: {
                    "X-CSRF-Token": csrf || "",
                    Authorization: "Bearer " + process.env.NODEBB_BEARER_TOKEN,
                },
            }
        );

        res.send(response.data);
    } catch (error) {
        console.error("Login error:", error.response?.data || error.message);

        if (error.response?.data) {
            return res.status(error.response.status || 500).json({
                error: "Login failed",
                details: error.response.data
            });
        }

        res.status(500).json({ message: "Error during login process" });
    }
});

module.exports = router;