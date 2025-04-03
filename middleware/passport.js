const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const { nodeBB } = require('../third_party/nodebb');

const configurePassport = () => {
    passport.serializeUser((user, done) => {
        // Include the CSRF token in the serialized user
        done(null, user);
    });

    passport.deserializeUser((serializedUser, done) => {
        done(null, serializedUser);
    });

    passport.use(new LocalStrategy(
        {
            usernameField: 'username',
            passwordField: 'password',
            passReqToCallback: true
        },
        async (req, username, password, done) => {
            try {
                // Complete NodeBB authentication flow
                const nodeBBSession = await nodeBB.initializeNodeBBSession(username, password);

                if (!nodeBBSession.success) {
                    return done(null, false, { message: 'NodeBB authentication failed' });
                }

                // Store user data and session information
                const userData = nodeBBSession.userData;
                const user = {
                    uid: userData.uid,
                    username: userData.username,
                    isAdmin: userData.groupTitleArray?.includes("administrators") || false,
                    validEmail: userData["email:confirmed"] === 1, // Add email validation status
                    csrfToken: nodeBBSession.csrfToken
                };

                // Set the NodeBB session cookie on the response
                if (req.res && nodeBBSession.sessionCookie) {
                    req.res.setHeader('Set-Cookie', nodeBBSession.sessionCookie);
                }

                console.log('User authenticated successfully:', username);
                return done(null, user);
            } catch (error) {
                console.error('Authentication error:', error);
                return done(error);
            }
        }
    ));
};

module.exports = configurePassport;