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

// Create a custom Axios instance for NodeBB API requests
const nodeBBAxios = axios.create({
    baseURL: getNodeBBServiceUrl()
});

// Function to get CSRF token - updated to work with session cookies
async function getCsrfToken(cookies = null) {
    console.log("Fetching new CSRF token");
    try {
        const config = { withCredentials: true };
        if (cookies) {
            config.headers = {
                Cookie: Array.isArray(cookies) ? cookies.join('; ') : cookies
            };
        }

        const response = await axios.get(`${getNodeBBServiceUrl()}/api/config`, config);
        if (response.data?.csrf_token) {
            console.log("CSRF token received:", response.data.csrf_token);

            // Return both token and any new cookies
            return {
                token: response.data.csrf_token,
                cookies: response.headers['set-cookie'] || cookies
            };
        }
        console.error("Failed to fetch CSRF token: No CSRF token in response");
        return { token: null, cookies: null };
    } catch (error) {
        console.error("Failed to fetch CSRF token:", error.message);
        throw error;
    }
}

// Add response interceptor to detect auth failures and refresh token
nodeBBAxios.interceptors.response.use(
    (response) => {
        // Log successful response status
        console.log(`NodeBB API response success: ${response.config.method.toUpperCase()} ${response.config.url} - Status: ${response.status}`);

        // If the response includes new cookies, store them
        if (response.headers['set-cookie']) {
            response.sessionCookies = response.headers['set-cookie'];
        }

        return response;
    },
    async (error) => {
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
            const originalRequest = error.config;

            // Prevent infinite loops - only retry once
            if (!originalRequest._retry) {
                console.log(`Authentication error detected (${error.response.status}), refreshing token and retrying...`);

                originalRequest._retry = true;

                try {
                    // Get a fresh token using the original cookies
                    const { token, cookies } = await getCsrfToken(originalRequest.sessionCookies);

                    if (!token) {
                        throw new Error("Failed to obtain new CSRF token");
                    }

                    console.log(`Retrying request with fresh token: ${token}`);

                    // Update the token and cookies in the request
                    originalRequest.headers['X-CSRF-Token'] = token;
                    if (cookies) {
                        originalRequest.headers.Cookie = Array.isArray(cookies)
                            ? cookies.join('; ')
                            : cookies;
                        originalRequest.sessionCookies = cookies;
                    }

                    // Retry the request
                    return nodeBBAxios(originalRequest);
                } catch (refreshError) {
                    console.error("Failed to refresh token for retry:", refreshError);
                    return Promise.reject(error);
                }
            }
        }

        // Log failed response details
        if (error.response) {
            console.error(`NodeBB API response error: ${error.config?.method?.toUpperCase()} ${error.config?.url} - Status: ${error.response.status}`);
            console.error("Response data:", error.response.data);
        } else if (error.request) {
            console.error(`NodeBB API request error: No response received for ${error.config?.method?.toUpperCase()} ${error.config?.url}`);
        } else {
            console.error(`NodeBB API error: ${error.message}`);
        }

        return Promise.reject(error);
    }
);

// Add interceptor to inject CSRF token and auth headers from session
nodeBBAxios.interceptors.request.use(async (config) => {
    try {
        let token;
        // If session token is provided in the config, use it
        if (config.sessionToken) {
            token = config.sessionToken;
        } else {
            // Otherwise try to get a fresh token
            const tokenResponse = await getCsrfToken(config.sessionCookies);
            token = tokenResponse.token;

            // Update cookies if we got new ones
            if (tokenResponse.cookies) {
                config.sessionCookies = tokenResponse.cookies;
            }
        }

        // Add headers to the request
        config.headers = {
            ...config.headers,
            'X-CSRF-Token': token
        };

        // Add cookies if available
        if (config.sessionCookies) {
            config.headers.Cookie = Array.isArray(config.sessionCookies)
                ? config.sessionCookies.join('; ')
                : config.sessionCookies;
        }

        // Log the request details
        console.log(`NodeBB API request: ${config.method.toUpperCase()} ${config.url}`);
        console.log("Request headers:", JSON.stringify(config.headers, null, 2));

        // Only log body for non-GET requests and if not too large
        if (config.data && config.method !== 'get') {
            const dataString = typeof config.data === 'string'
                ? config.data
                : JSON.stringify(config.data);

            // Only log first 500 chars if large
            if (dataString.length > 500) {
                console.log(`Request body (truncated): ${dataString.substring(0, 500)}...`);
            } else {
                console.log("Request body:", dataString);
            }
        }

        return config;
    } catch (error) {
        console.error("Error in request interceptor:", error);
        return Promise.reject(error);
    }
});

const nodeBB = {
    // Expose token management
    getCsrfToken,

    // Helper method to make requests with session context
    async makeRequest(method, url, data = null, session = null) {
        const config = {
            method,
            url,
            withCredentials: true
        };

        if (data && method.toLowerCase() !== 'get') {
            config.data = data;
        }

        // Add session token and cookies if available
        if (session?.nodeBB) {
            config.sessionToken = session.nodeBB.csrfToken;
            config.sessionCookies = session.nodeBB.cookies;
        }

        return this.api(config);
    },

    // Expose the Axios instance directly
    api: nodeBBAxios,

    async initializeNodeBBSession(username, password) {
        try {
            console.log("Starting NodeBB session initialization");

            // First get the CSRF token
            const { token: csrfToken, cookies: initialCookies } = await getCsrfToken();
            console.log("Using CSRF Token:", csrfToken);

            // Now login to NodeBB with the CSRF token
            console.log(`Logging into NodeBB`);
            const loginResponse = await this.api({
                method: 'post',
                url: '/api/v3/utilities/login',
                data: {
                    username: username,
                    password: password,
                },
                headers: {
                    'X-CSRF-Token': csrfToken
                },
                withCredentials: true,
                sessionCookies: initialCookies
            });

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

            // Use the cookies from login response for subsequent requests
            const loginCookies = loginResponse.headers['set-cookie'] || initialCookies;

            // User data fetching with improved error handling
            console.log("Getting more user data for passport cookie...");
            let userData = null;

            try {
                const getUserResponse = await this.api({
                    method: 'get',
                    url: `/api/user/username/${username}`,
                    headers: {
                        'X-CSRF-Token': csrfToken,
                        Cookie: Array.isArray(loginCookies) ? loginCookies.join('; ') : loginCookies
                    },
                    withCredentials: true,
                    sessionCookies: loginCookies,
                    sessionToken: csrfToken
                });

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

            // Store the CSRF token from the login response if available, otherwise use the one from config
            const finalCsrfToken = loginResponse.data?.user?.csrfToken || csrfToken;
            const finalCookies = loginResponse.headers['set-cookie'] || loginCookies;

            return {
                success: true,
                cookies: finalCookies,
                csrfToken: finalCsrfToken,
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
            const response = await this.api.get('/api/config', { timeout: 5000 });

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

        // Middleware to ensure NodeBB session exists
        const ensureNodeBBSession = async (req, res, next) => {
            // Skip for non-authenticated requests
            if (!req.isAuthenticated()) {
                return res.status(401).json({ error: 'Authentication required' });
            }

            try {
                // Check if NodeBB session exists
                if (!req.session.nodeBB?.cookies || !req.session.nodeBB?.csrfToken) {
                    console.log('NodeBB session not found, attempting to refresh...');

                    // We already have authenticated user data from passport
                    if (req.user && req.user.username) {
                        console.log('Found user data in passport session, attempting to refresh NodeBB session');

                        // Try to get a fresh token using any existing cookies
                        const existingCookies = req.session.nodeBB?.cookies;
                        const { token, cookies } = await this.getCsrfToken(existingCookies);

                        // Initialize nodeBB property if it doesn't exist
                        if (!req.session.nodeBB) {
                            req.session.nodeBB = {};
                        }

                        // Set token and cookies in session
                        if (token) req.session.nodeBB.csrfToken = token;
                        if (cookies) req.session.nodeBB.cookies = cookies;

                        // Save the session
                        await new Promise((resolve, reject) => {
                            req.session.save(err => {
                                if (err) reject(err);
                                else resolve();
                            });
                        });

                        console.log('NodeBB session refreshed with new token');
                        return next();
                    }

                    return res.status(401).json({
                        error: 'NodeBB session not found',
                        details: 'Please log in again to refresh your session'
                    });
                }

                next();
            } catch (error) {
                console.error('Error in ensureNodeBBSession middleware:', error);
                res.status(500).json({
                    error: 'Internal server error',
                    message: 'Failed to validate NodeBB session'
                });
            }
        };

        // Generic NodeBB proxy that forwards all requests
        router.all('*', ensureNodeBBSession, async (req, res) => {
            try {
                // Get the path from the request (after /forward/nodebb)
                const nodeBBPath = req.path.replace(/^\/+/, '');
                console.log(`Proxying request to NodeBB: ${nodeBBPath}`);

                // Debug the session state
                console.log('NodeBB Session State:', {
                    hasCookies: !!req.session.nodeBB?.cookies,
                    hasCSRF: !!req.session.nodeBB?.csrfToken,
                    csrfToken: req.session.nodeBB?.csrfToken,
                });

                // Make the request using the session info
                const response = await this.makeRequest(
                    req.method,
                    nodeBBPath,
                    ['POST', 'PUT', 'PATCH'].includes(req.method) ? req.body : null,
                    req.session
                );

                console.log(`Proxy response status: ${response.status}`);

                // Update session cookies if we got new ones
                if (response.sessionCookies) {
                    // Update NodeBB cookies in the session
                    req.session.nodeBB.cookies = response.sessionCookies;

                    // Save the updated session
                    req.session.save(err => {
                        if (err) console.error('Error saving session after updating cookies:', err);
                    });

                    // Forward cookies to client
                    response.sessionCookies.forEach(cookie => {
                        res.append('Set-Cookie', cookie);
                    });
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
                        message: error.message,
                        details: error.response.data
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