// ./middleware/passport.js
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const axios = require('axios');

/**
 * Configure Passport.js authentication
 * @param {Object} app - Express app instance
 */
const configurePassport = (app) => {
    // Initialize passport
    app.use(passport.initialize());
    app.use(passport.session());

    // Passport serialization/deserialization for session support
    passport.serializeUser((user, done) => {
        // Only store the user ID in the session
        console.log('Serializing user:', user);
        done(null, user.uid);
    });

    passport.deserializeUser(async (uid, done) => {
        try {
            console.log('Deserializing user ID:', uid);
            // We could fetch more user data here if needed, but the UID is sufficient
            done(null, { uid });
        } catch (err) {
            console.error('User deserialization error:', err);
            done(err, null);
        }
    });

    // Set up the LocalStrategy for username/password authentication
    passport.use(new LocalStrategy(
        {
            usernameField: 'username',
            passwordField: 'password',
            passReqToCallback: true // allows us to pass the entire request to the callback
        },
        async (req, username, password, done) => {
            try {
                console.log(`Authenticating user: ${username}`);

                // Call NodeBB login API
                const response = await axios.post(
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
                        }
                    }
                );

                if (response.data && response.data.success) {
                    console.log(`User ${username} authenticated successfully`);

                    // Pass along cookie headers to the session
                    if (response.headers["set-cookie"]) {
                        console.log('Storing NodeBB cookies for later use');
                        req.loginCookies = response.headers["set-cookie"];
                    }

                    // Return the user object
                    return done(null, {
                        uid: response.data.user.uid,
                        username: response.data.user.username
                    });
                } else {
                    console.log(`Authentication failed for user: ${username}`);
                    return done(null, false, { message: 'Invalid username or password' });
                }
            } catch (error) {
                console.error('Login error:', error.message);
                if (error.response) {
                    console.error('Response status:', error.response.status);
                    console.error('Response data:', error.response.data);
                }
                return done(error);
            }
        }
    ));

    return passport;
};

module.exports = configurePassport;