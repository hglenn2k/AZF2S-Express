const axios = require('axios');

class NodeBBError extends Error {
    constructor(message, statusCode = 500, details = null) {
        super(message);
        this.name = 'NodeBBError';
        this.statusCode = statusCode;
        this.details = details;
    }
}

function getNodeBBServiceUrl() {
    return process.env.NODEBB_SERVICE_URL || `${process.env.PROTOCOL}${process.env.DOMAIN}${process.env.FORUM_PROXY_ROUTE}`;
}

const nodeBB = {
    async initializeNodeBBSession(username, password) {
        try {
            console.log("Starting NodeBB session initialization");

            // First get the CSRF token from /api/config
            const configResponse = await axios.get(
                `${getNodeBBServiceUrl()}/api/config`,
                { withCredentials: true }
            );

            console.log("Config Response Headers:", JSON.stringify(configResponse.headers, null, 2));
            console.log("Config Cookies:", configResponse.headers['set-cookie']);

            const csrfToken = configResponse.data?.csrf_token;
            if (!csrfToken) {
                console.log("No csrf token found");
                throw new NodeBBError('CSRF token not found in NodeBB response', 502);
            }
            else {
                console.log("CSRF Token:", csrfToken);
            }

            // Now login to NodeBB with the CSRF token
            console.log(`Logging into NodeBB with Bearer ${process.env.NODEBB_BEARER_TOKEN}`);
            const loginResponse = await axios.post(
                `${getNodeBBServiceUrl()}/api/v3/utilities/login`,
                {
                    username: username,
                    password: password,
                },
                {
                    headers: {
                        'X-CSRF-Token': csrfToken,
                        Authorization: `Bearer ${process.env.NODEBB_BEARER_TOKEN}`,
                        Cookie: configResponse.headers['set-cookie']?.join('; ')
                    },
                    withCredentials: true
                }
            );

            console.log("Login Response Headers:", JSON.stringify(loginResponse.headers, null, 2));
            console.log("Login Cookies:", loginResponse.headers['set-cookie']);
            console.log("Login Response Data:", JSON.stringify(loginResponse.data, null, 2));

            if (!(loginResponse.data?.status?.code === "ok")) {
                throw new NodeBBError(
                    'NodeBB authentication failed',
                    401,
                    loginResponse.data
                );
            }

            // User data fetching with improved error handling
            console.log("Getting more user data for passport cookie...");
            let userData = null;

            try {
                const getUserResponse = await axios.get(
                    `${getNodeBBServiceUrl()}/api/user/username/${username}`,
                    {
                        username: username
                    },
                    {
                        headers: {
                            'X-CSRF-Token': csrfToken,
                            Authorization: `Bearer ${process.env.NODEBB_BEARER_TOKEN}`,
                            Cookie: configResponse.headers['set-cookie']?.join('; ')
                        },
                        withCredentials: true
                    }
                );

                console.log("GetUser Response Status:", getUserResponse.status);
                console.log("GetUser Response Headers:", JSON.stringify(getUserResponse.headers, null, 2));

                if (!getUserResponse.data || !getUserResponse.data.uid) {
                    console.error("GetUser API returned unexpected data format:", JSON.stringify(getUserResponse.data, null, 2));
                    throw new Error("Invalid user data response format");
                }

                userData = getUserResponse.data;
                console.log("User data successfully retrieved with admin status: ", userData.groupTitleArray?.includes("administrators"));
            } catch (userDataError) {
                console.error("Failed to fetch additional user data:", userDataError.message);
                console.error("Error details:", userDataError.response?.data || "No response data");
                console.error("Error status:", userDataError.response?.status || "No status code");

                // Fall back to basic user data from login response if possible
                if (loginResponse.data && loginResponse.data.user) {
                    console.log("Falling back to basic user data from login response");
                    userData = loginResponse.data.user;
                    console.warn("Admin status may not be accurate with fallback data");
                } else {
                    // Cannot proceed without user data
                    throw new NodeBBError(
                        'Failed to retrieve user data after successful login',
                        userDataError.response?.status || 500,
                        userDataError.response?.data || { message: userDataError.message }
                    );
                }
            }

            return {
                success: true,
                cookies: loginResponse.headers['set-cookie'],
                csrfToken: csrfToken,
                userData: userData
            };
        } catch (error) {
            if (error instanceof NodeBBError) {
                throw error;
            }

            // Handle axios errors
            if (error.response) {
                throw new NodeBBError(
                    'NodeBB request failed',
                    error.response.status,
                    error.response.data
                );
            }

            throw new NodeBBError('NodeBB service unavailable', 503);
        }
    },

    async verifyNodeBBHealth() {
        try {
            const response = await axios.get(
                `${getNodeBBServiceUrl()}/api/config`,
                { timeout: 5000 }
            );
            return {
                status: 'ok',
                version: response.data?.version || 'unknown',
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                status: 'error',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    },

    createProxyRouter() {
        const express = require('express');
        const router = express.Router();

        // Generic NodeBB proxy that forwards all requests
        router.all('*', async (req, res) => {
            try {
                if (!req.isAuthenticated()) {
                    return res.status(401).json({ error: 'Authentication required' });
                }

                // Get NodeBB session info from the user's Express session
                if (!req.session.nodeBB?.cookies || !req.session.nodeBB?.csrfToken) {
                    return res.status(401).json({ error: 'NodeBB session not found' });
                }

                // Get the path from the request (after /api/express/forward/nodebb)
                const nodeBBPath = req.path.replace(/^\/+/, '');

                // Prepare the request config
                const config = {
                    method: req.method,
                    url: `${getNodeBBServiceUrl()}/${nodeBBPath}`,
                    headers: {
                        Cookie: req.session.nodeBB.cookies.join('; '),
                        'X-CSRF-Token': req.session.nodeBB.csrfToken,
                        Authorization: `Bearer ${process.env.NODEBB_BEARER_TOKEN}`
                    },
                    params: req.query,
                    data: ['POST', 'PUT', 'PATCH'].includes(req.method) ? req.body : undefined,
                    withCredentials: true
                };

                // Make the request to NodeBB
                const response = await axios(config);

                // Forward any cookies from NodeBB to the client
                if (response.headers['set-cookie']) {
                    response.headers['set-cookie'].forEach(cookie => {
                        res.append('Set-Cookie', cookie);
                    });

                    // Update NodeBB cookies in the session
                    req.session.nodeBB.cookies = response.headers['set-cookie'];
                }

                // Return the response
                res.status(response.status).send(response.data);
            } catch (error) {
                console.error('NodeBB proxy error:', error.message);

                // Forward NodeBB error responses if they exist
                if (error.response) {
                    return res.status(error.response.status).json({
                        error: 'NodeBB request failed',
                        status: error.response.status,
                        message: error.message
                    });
                }

                // Otherwise return a generic error
                res.status(500).json({
                    error: 'NodeBB proxy error',
                    message: error.message
                });
            }
        });

        return router;
    }
};

module.exports = {
    nodeBB,
    getNodeBBServiceUrl
};