// tests/validateSession_test.js
const assert = require('assert');
const { test, runTests } = require('./testRunner.js');
const { validateSession, validateAdminSession } = require('../middleware/validateSession');

// Mock for process.env
process.env.DOMAIN = 'https://example.com';
process.env.FORUM_PROXY_ROUTE = '/forum';

/**
 * Validate session middleware
 * @returns {Promise<boolean>} True if validation passes
 */
async function validateSessionMiddleware() {
    const tests = [
        // Test 1: Module exports all required functions
        () => test('Should export all required functions', () => {
            assert.strictEqual(
                typeof validateSession,
                'function',
                'Missing or invalid function: validateSession'
            );

            assert.strictEqual(
                typeof validateAdminSession,
                'function',
                'Missing or invalid function: validateAdminSession'
            );
        }),

        // Test 2: validateSession should reject requests without session
        () => test('validateSession should reject requests without session', () => {
            // Mock Express request, response, and next function
            const req = {};

            let statusCode = 0;
            let responseBody = null;

            const res = {
                status: (code) => {
                    statusCode = code;
                    return res;
                },
                json: (body) => {
                    responseBody = body;
                    return res;
                }
            };

            let nextCalled = false;
            const next = () => {
                nextCalled = true;
            };

            // Call middleware
            validateSession(req, res, next);

            assert.strictEqual(statusCode, 401, 'Should respond with 401 status code');
            assert.deepStrictEqual(
                responseBody,
                { success: false, message: "Unauthorized" },
                'Should return unauthorized message'
            );
            assert.strictEqual(nextCalled, false, 'Should not call next function');
        }),

        // Test 3: validateSession should reject requests with incomplete session
        () => test('validateSession should reject requests with incomplete session', () => {
            // Mock Express request with incomplete session
            const req = {
                session: {}
            };

            let statusCode = 0;
            let responseBody = null;

            const res = {
                status: (code) => {
                    statusCode = code;
                    return res;
                },
                json: (body) => {
                    responseBody = body;
                    return res;
                }
            };

            let nextCalled = false;
            const next = () => {
                nextCalled = true;
            };

            // Call middleware
            validateSession(req, res, next);

            assert.strictEqual(statusCode, 401, 'Should respond with 401 status code');
            assert.deepStrictEqual(
                responseBody,
                { success: false, message: "Unauthorized" },
                'Should return unauthorized message'
            );
            assert.strictEqual(nextCalled, false, 'Should not call next function');
        }),

        // Test 4: validateSession should accept valid session and set req.uid
        () => test('validateSession should accept valid session and set req.uid', () => {
            // Mock Express request with valid session
            const req = {
                session: {
                    passport: {
                        user: '12345'
                    }
                }
            };

            const res = {};

            let nextCalled = false;
            const next = () => {
                nextCalled = true;
            };

            // Call middleware
            validateSession(req, res, next);

            assert.strictEqual(req.uid, '12345', 'Should set req.uid from session');
            assert.strictEqual(nextCalled, true, 'Should call next function');
        }),

        // Test 5: validateAdminSession should reject requests without session
        () => test('validateAdminSession should reject requests without session', () => {
            // Mock Express request, response, and next function
            const req = {};

            let statusCode = 0;
            let responseBody = null;

            const res = {
                status: (code) => {
                    statusCode = code;
                    return res;
                },
                json: (body) => {
                    responseBody = body;
                    return res;
                }
            };

            let nextCalled = false;
            const next = () => {
                nextCalled = true;
            };

            // Call middleware
            validateAdminSession(req, res, next)
                .then(() => {
                    assert.strictEqual(statusCode, 401, 'Should respond with 401 status code');
                    assert.deepStrictEqual(
                        responseBody,
                        { success: false, message: "Unauthorized" },
                        'Should return unauthorized message'
                    );
                    assert.strictEqual(nextCalled, false, 'Should not call next function');
                });
        }),

        // Test 6: validateAdminSession should verify admin status for valid sessions
        () => test('validateAdminSession should verify admin status for valid sessions', async () => {
            // Mock the global fetch function
            const originalFetch = global.fetch;

            // Mock for successful admin check
            global.fetch = async () => ({
                ok: true,
                json: async () => ({
                    admins: {
                        members: [
                            { uid: '12345' },
                            { uid: '67890' }
                        ]
                    }
                })
            });

            // Mock Express request with valid session
            const req = {
                session: {
                    passport: {
                        user: '12345'
                    }
                },
                headers: {
                    cookie: 'session=abc123'
                }
            };

            let statusCode = 0;
            let responseBody = null;

            const res = {
                status: (code) => {
                    statusCode = code;
                    return res;
                },
                json: (body) => {
                    responseBody = body;
                    return res;
                }
            };

            let nextCalled = false;
            const next = () => {
                nextCalled = true;
            };

            // Call middleware
            await validateAdminSession(req, res, next);

            assert.strictEqual(nextCalled, true, 'Should call next for admin users');

            // Restore original fetch
            global.fetch = originalFetch;
        }),

        // Test 7: validateAdminSession should reject non-admin users
        () => test('validateAdminSession should reject non-admin users', async () => {
            // Mock the global fetch function
            const originalFetch = global.fetch;

            // Mock for successful admin check but user is not an admin
            global.fetch = async () => ({
                ok: true,
                json: async () => ({
                    admins: {
                        members: [
                            { uid: '67890' }
                        ]
                    }
                })
            });

            // Mock Express request with valid session but non-admin user
            const req = {
                session: {
                    passport: {
                        user: '12345'
                    }
                },
                headers: {
                    cookie: 'session=abc123'
                }
            };

            let statusCode = 0;
            let responseBody = null;

            const res = {
                status: (code) => {
                    statusCode = code;
                    return res;
                },
                json: (body) => {
                    responseBody = body;
                    return res;
                }
            };

            let nextCalled = false;
            const next = () => {
                nextCalled = true;
            };

            // Call middleware
            await validateAdminSession(req, res, next);

            assert.strictEqual(statusCode, 403, 'Should respond with 403 status code');
            assert.deepStrictEqual(
                responseBody,
                { error: "You need to be an administrator to do that" },
                'Should return admin required message'
            );
            assert.strictEqual(nextCalled, false, 'Should not call next function for non-admin users');

            // Restore original fetch
            global.fetch = originalFetch;
        }),

        // Test 8: validateAdminSession should handle fetch errors
        () => test('validateAdminSession should handle fetch errors', async () => {
            // Mock the global fetch function
            const originalFetch = global.fetch;
            const fetchError = new Error('Network error');

            // Mock fetch to throw an error
            global.fetch = async () => {
                throw fetchError;
            };

            // Mock Express request with valid session
            const req = {
                session: {
                    passport: {
                        user: '12345'
                    }
                },
                headers: {
                    cookie: 'session=abc123'
                }
            };

            let statusCode = 0;
            let responseBody = null;

            const res = {
                status: (code) => {
                    statusCode = code;
                    return res;
                },
                json: (body) => {
                    responseBody = body;
                    return res;
                }
            };

            let nextCalled = false;
            const next = () => {
                nextCalled = true;
            };

            // Mock console.error to prevent test output noise
            const originalConsoleError = console.error;
            console.error = () => {};

            // Call middleware
            await validateAdminSession(req, res, next);

            assert.strictEqual(statusCode, 500, 'Should respond with 500 status code');
            assert.deepStrictEqual(
                responseBody,
                { error: "Error validating session" },
                'Should return error message'
            );
            assert.strictEqual(nextCalled, false, 'Should not call next function on error');

            // Restore originals
            global.fetch = originalFetch;
            console.error = originalConsoleError;
        }),

        // Test 9: validateAdminSession should handle response not OK
        () => test('validateAdminSession should handle response not OK', async () => {
            // Mock the global fetch function
            const originalFetch = global.fetch;

            // Mock for failed admin check
            global.fetch = async () => ({
                ok: false,
                json: async () => ({
                    error: "Server error"
                })
            });

            // Mock Express request with valid session
            const req = {
                session: {
                    passport: {
                        user: '12345'
                    }
                },
                headers: {
                    cookie: 'session=abc123'
                }
            };

            let statusCode = 0;
            let responseBody = null;

            const res = {
                status: (code) => {
                    statusCode = code;
                    return res;
                },
                json: (body) => {
                    responseBody = body;
                    return res;
                }
            };

            let nextCalled = false;
            const next = () => {
                nextCalled = true;
            };

            // Call middleware
            await validateAdminSession(req, res, next);

            assert.strictEqual(statusCode, 403, 'Should respond with 403 status code');
            assert.deepStrictEqual(
                responseBody,
                { error: "Unable to fetch admin data" },
                'Should return fetch error message'
            );
            assert.strictEqual(nextCalled, false, 'Should not call next function on failed response');

            // Restore original fetch
            global.fetch = originalFetch;
        })
    ];

    return await runTests(tests);
}

// Run validation immediately when this file is loaded
console.log('Running session validation middleware tests...');
validateSessionMiddleware().then(allPassed => {
    if (!allPassed) {
        console.error('❌ FATAL ERROR: Session validation middleware tests failed!');
        process.exit(1);
    } else {
        console.log('✅ Session validation middleware validated successfully');
    }
}).catch(error => {
    console.error('❌ FATAL ERROR: Unexpected error during validation:', error);
    process.exit(1);
});

module.exports = { validateSessionMiddleware };