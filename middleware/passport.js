const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const { nodeBB } = require('../third_party/nodebb');

const configurePassport = () => {
    passport.serializeUser((user, done) => {
        done(null, {
            uid: user.uid,
            username: user.username,
            csrfToken: user.csrfToken,
            emailConfirmed: user.emailConfirmed,
            isAdmin: user.isAdmin
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
                // NodeBB session already fetches user data
                const nodeBBSession = await nodeBB.initializeNodeBBSession(username, password);

                if (!nodeBBSession.success) {
                    return done(null, false, { message: 'NodeBB authentication failed' });
                }

                // Store NodeBB cookies in the user's session
                if (!req.session.nodeBB) {
                    req.session.nodeBB = {};
                }
                req.session.nodeBB.cookies = nodeBBSession.cookies;
                req.session.nodeBB.csrfToken = nodeBBSession.csrfToken;

                // Store NodeBB cookies in the request object
                req.loginCookies = nodeBBSession.cookies;

                // Create minimal user object with the data from NodeBB
                const userData = nodeBBSession.userData;
                const user = {
                    uid: userData.uid,
                    username: userData.username,
                    csrfToken: nodeBBSession.csrfToken,
                    emailConfirmed: userData['email:confirmed'] || 0,
                    isAdmin: userData.groupTitleArray?.includes("administrators") || false
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