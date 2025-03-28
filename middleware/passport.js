const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const { nodeBB } = require('../third_party/nodebb');

const configurePassport = () => {
    passport.serializeUser((user, done) => {
        // Store all necessary user data in the session
        done(null, {
            uid: user.uid,
            username: user.username,
            csrfToken: user.csrfToken,
            emailConfirmed: user.emailConfirmed,
            isAdmin: user.isAdmin
        });
    });

    passport.deserializeUser((serializedUser, done) => {
        // Pass the user object directly as stored during serialization
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
                // Initialize or clear nodeBB session data
                if (!req.session.nodeBB) {
                    req.session.nodeBB = {};
                }

                // NodeBB session initialization
                const nodeBBSession = await nodeBB.initializeNodeBBSession(username, password);

                if (!nodeBBSession.success) {
                    return done(null, false, { message: 'NodeBB authentication failed' });
                }

                // Store NodeBB cookies and CSRF token in the session
                req.session.nodeBB.cookies = nodeBBSession.cookies;
                req.session.nodeBB.csrfToken = nodeBBSession.csrfToken;

                // Save the session explicitly to ensure data is stored
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

                // Create user object with the data from NodeBB
                const userData = nodeBBSession.userData;
                const user = {
                    uid: userData.uid,
                    username: userData.username,
                    csrfToken: nodeBBSession.csrfToken,
                    emailConfirmed: userData['email:confirmed'] || 0,
                    isAdmin: userData.groupTitleArray?.includes("administrators") ||
                        userData.isAdmin || false
                };

                console.log('User authenticated successfully:', username);
                console.log('User data:', JSON.stringify(user, null, 2));
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