const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const axios = require('axios');

/**
 * Configure Passport.js authentication
 */
const configurePassport = () => {
    // Passport serialization/deserialization for session support
    passport.serializeUser((user, done) => {
        console.log('Serializing user:', user);
        done(null, user);
    });

    passport.deserializeUser((user, done) => {
        console.log('Deserializing user:', user);
        // Simply return the user object that was stored in the session
        done(null, user);
    });

    // Set up the LocalStrategy for username/password authentication
    passport.use(new LocalStrategy(
        {
            usernameField: 'username',
            passwordField: 'password',
            passReqToCallback: true
        },
        async (req, username, password, done) => {
            try {
                console.log(`Authenticating user: ${username}`);

                // Call NodeBB login API
                const response = await axios.post(
                    `${process.env.DOMAIN}/api/nodebb/api/v3/utilities/login`,
                    {
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

                    // Store cookies in the request object for forwarding to client
                    if (response.headers["set-cookie"]) {
                        console.log('Found NodeBB cookies for forwarding');
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
};

module.exports = configurePassport;