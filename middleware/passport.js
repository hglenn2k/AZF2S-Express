const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const { nodeBB } = require('../third_party/nodebb');

const configurePassport = () => {
    passport.serializeUser((user, done) => {
        done(null, {
            uid: user.uid,
            username: user.username,
            nodeBBCsrfToken: user.nodeBBCsrfToken
        });
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
                // Initialize NodeBB session first
                const nodeBBSession = await nodeBB.initializeNodeBBSession(username, password);

                if (!nodeBBSession.success) {
                    return done(null, false, { message: 'NodeBB authentication failed' });
                }

                // Store NodeBB cookies and CSRF token in the request object
                req.loginCookies = nodeBBSession.cookies;
                req.nodeBBCsrfToken = nodeBBSession.csrfToken;

                // Create user object with NodeBB data
                const user = {
                    uid: nodeBBSession.userData.uid,
                    username: nodeBBSession.userData.username,
                    nodeBBCsrfToken: nodeBBSession.csrfToken // Store for future requests
                };

                return done(null, user);
            } catch (error) {
                console.error('Authentication error:', error);
                return done(error);
            }
        }
    ));
};

module.exports = configurePassport;