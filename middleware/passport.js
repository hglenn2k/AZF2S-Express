const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const { nodeBB } = require('../third_party/nodebb');

const configurePassport = () => {
    passport.serializeUser((user, done) => {
        done(null, {
            uid: user.uid,
            username: user.username,
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
                // Authenticate with NodeBB using Bearer token
                const nodeBBSession = await nodeBB.initializeNodeBBSession(username, password);

                if (!nodeBBSession.success) {
                    return done(null, false, { message: 'NodeBB authentication failed' });
                }

                // Create minimal user object
                const userData = nodeBBSession.userData;
                const user = {
                    uid: userData.uid,
                    username: userData.username,
                    isAdmin: userData.groupTitleArray?.includes("administrators") || false
                };

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