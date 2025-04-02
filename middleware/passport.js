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
                // Initialize nodeBB session container
                if (!req.session.nodeBB) {
                    req.session.nodeBB = {};
                }

                // Get NodeBB session
                const nodeBBSession = await nodeBB.initializeNodeBBSession(username, password);

                if (!nodeBBSession.success) {
                    return done(null, false, { message: 'NodeBB authentication failed' });
                }

                // Store NodeBB session data
                req.session.nodeBB = {
                    cookies: nodeBBSession.cookies,
                    csrfToken: nodeBBSession.csrfToken
                };

                // Save session before continuing
                await new Promise((resolve, reject) => {
                    req.session.save(err => {
                        if (err) {
                            console.error('Error saving session after NodeBB login:', err);
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                });

                // Create minimal user object
                const userData = nodeBBSession.userData;
                const user = {
                    uid: userData.uid,
                    username: userData.username,
                    isAdmin: userData.groupTitleArray?.includes("administrators") || false
                };

                console.log('User authenticated successfully:', username);
                console.log('Session state after login:', {
                    id: req.sessionID,
                    hasNodeBB: !!req.session.nodeBB,
                    hasCookies: !!req.session.nodeBB?.cookies,
                    hasCSRF: !!req.session.nodeBB?.csrfToken
                });

                return done(null, user);
            } catch (error) {
                console.error('Authentication error:', error);
                return done(error);
            }
        }
    ));
};

module.exports = configurePassport;