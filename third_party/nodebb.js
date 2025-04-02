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

// Function to get CSRF token - using existing session if available
async function getCsrfToken(cookies = null) {
    console.log("Fetching CSRF token");
    try {
        const config = { withCredentials: true };
        if (cookies) {
            console.log("Using existing session cookies for CSRF request");
            config.headers = {
                Cookie: Array.isArray(cookies) ? cookies.join('; ') : cookies
            };
        }

        const response = await axios.get(`${getNodeBBServiceUrl()}/api/config`, config);
        if (response.data?.csrf_token) {
            console.log("CSRF token received");
            // If we have existing cookies, keep them - don't create new session
            return {
                token: response.data.csrf_token,
                cookies: cookies || response.headers['set-cookie']
            };
        }
        console.error("Failed to fetch CSRF token: No token in response");
        return { token: null, cookies: null };
    } catch (error) {
        console.error("Failed to fetch CSRF token:", error.message);
        throw error;
    }
}

// Add response interceptor to detect auth failures
nodeBBAxios.interceptors.response.use(
    (response) => {
        console.log(`NodeBB API response success: ${response.config.method.toUpperCase()} ${response.config.url} - Status: ${response.status}`);
        return response;
    },
    async (error) => {
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
            const originalRequest = error.config;

            if (!originalRequest._retry) {
                console.log(`Authentication error detected (${error.response.status})`);
                originalRequest._retry = true;

                try {
                    // Use original session cookies when refreshing token
                    const { token } = await getCsrfToken(originalRequest.sessionCookies);
                    if (!token) {
                        throw new Error("Failed to obtain new CSRF token");
                    }

                    originalRequest.headers['X-CSRF-Token'] = token;
                    return nodeBBAxios(originalRequest);
                } catch (refreshError) {
                    console.error("Failed to refresh token for retry:", refreshError);
                    return Promise.reject(error);
                }
            }
        }

        if (error.response) {
            console.error("NodeBB API error:", error.response.status, error.response.data);
        }
        return Promise.reject(error);
    }
);

// Add interceptor to inject CSRF token and auth headers
nodeBBAxios.interceptors.request.use(async (config) => {
    try {
        // If we have session data, always use it
        if (config.sessionToken && config.sessionCookies) {
            config.headers = {
                ...config.headers,
                'X-CSRF-Token': config.sessionToken,
                'Cookie': Array.isArray(config.sessionCookies)
                    ? config.sessionCookies.join('; ')
                    : config.sessionCookies
            };

            console.log('Using existing session:', {
                hasToken: !!config.sessionToken,
                hasCookies: !!config.sessionCookies
            });

            return config;
        }

        // Otherwise get fresh token/cookies
        const { token, cookies } = await getCsrfToken(config.sessionCookies);
        if (!token) {
            throw new Error('Failed to get CSRF token');
        }

        config.headers = {
            ...config.headers,
            'X-CSRF-Token': token
        };

        if (cookies) {
            config.headers.Cookie = Array.isArray(cookies)
                ? cookies.join('; ')
                : cookies;
        }

        return config;
    } catch (error) {
        console.error('Error in request interceptor:', error);
        return Promise.reject(error);
    }
});

const nodeBB = {
    getCsrfToken,

    async makeRequest(method, url, data = null, session = null) {
        const config = {
            method,
            url,
            withCredentials: true
        };

        if (data && method.toLowerCase() !== 'get') {
            config.data = data;
        }

        if (session?.nodeBB) {
            config.sessionToken = session.nodeBB.csrfToken;
            config.sessionCookies = session.nodeBB.cookies;
        }

        return this.api(config);
    },

    api: nodeBBAxios,

    async initializeNodeBBSession(username, password) {
        try {
            console.log("Starting NodeBB session initialization");

            // Get initial CSRF token
            const { token: csrfToken } = await getCsrfToken();

            // Login to NodeBB
            const loginResponse = await this.api({
                method: 'post',
                url: '/api/v3/utilities/login',
                data: { username, password },
                headers: { 'X-CSRF-Token': csrfToken },
                withCredentials: true
            });

            if (!(loginResponse.data?.status?.code === "ok")) {
                throw new NodeBBError('NodeBB authentication failed', 401);
            }

            // Use login session for subsequent requests
            const sessionCookie = loginResponse.headers['set-cookie']?.find(
                cookie => cookie.startsWith('express.sid=')
            );

            if (!sessionCookie) {
                throw new NodeBBError('No NodeBB session cookie received', 500);
            }

            // Get user data using established session
            const getUserResponse = await this.api({
                method: 'get',
                url: `/api/user/username/${username}`,
                headers: {
                    'Cookie': sessionCookie,
                    'X-CSRF-Token': csrfToken
                },
                withCredentials: true
            });

            if (!getUserResponse.data?.uid) {
                throw new NodeBBError('Invalid user data response', 500);
            }

            return {
                success: true,
                cookies: [sessionCookie], // Store only NodeBB session cookie
                csrfToken: csrfToken,
                userData: getUserResponse.data
            };
        } catch (error) {
            console.error('NodeBB session initialization failed:', error);
            throw error;
        }
    },

    async verifyNodeBBHealth() {
        try {
            const response = await axios.get(`${getNodeBBServiceUrl()}/api/config`, {
                timeout: 5000
            });

            return {
                status: 'ok',
                details: {
                    version: response.data?.version || 'unknown',
                    uptime: response.data?.uptime || 'unknown'
                },
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

        router.use((req, res, next) => {
            console.log('Proxy router session check:', {
                routeSessionID: req.sessionID,
                hasNodeBB: !!req.session?.nodeBB,
                // Log the session keys to see what's there
                sessionKeys: req.session ? Object.keys(req.session) : []
            });
            next();
        });

        // Add a debugging middleware to inspect the cookie headers
        router.use((req, res, next) => {
            console.log('=============== COOKIE DEBUG ===============');
            console.log('Request URL:', req.originalUrl);
            console.log('Session ID:', req.sessionID);
            console.log('Cookie Header:', req.headers.cookie);

            // Parse and log individual cookies
            const cookies = req.headers.cookie ?
                req.headers.cookie.split(';').reduce((obj, c) => {
                    const [key, val] = c.trim().split('=');
                    obj[key] = val;
                    return obj;
                }, {}) : {};

            console.log('Parsed Cookies:', JSON.stringify(cookies, null, 2));
            console.log('Has express.sid:', !!cookies['express.sid']);
            console.log('Has connect.sid:', !!cookies['connect.sid']);
            console.log('===========================================');
            next();
        });

        // Regular authentication and proxy logic
        router.use(async (req, res, next) => {
            if (!req.isAuthenticated()) {
                return res.status(401).json({ error: 'Authentication required' });
            }

            try {
                // Debug session state
                console.log('NodeBB Proxy Session State:', {
                    sessionId: req.sessionID,
                    hasNodeBB: !!req.session.nodeBB,
                    cookies: req.session.nodeBB?.cookies,
                    csrfToken: req.session.nodeBB?.csrfToken,
                    user: req.user ? {
                        uid: req.user.uid,
                        username: req.user.username
                    } : null
                });

                const nodeBBPath = req.path.replace(/\/+/g, '/').replace(/^\//, '');
                console.log(`Proxying request to NodeBB: ${nodeBBPath}`);

                // Ensure we have NodeBB session data
                if (!req.session?.nodeBB?.cookies?.[0] || !req.session?.nodeBB?.csrfToken) {
                    console.error('Missing NodeBB session data:', {
                        hasCookies: !!req.session?.nodeBB?.cookies,
                        hasToken: !!req.session?.nodeBB?.csrfToken
                    });
                    return res.status(401).json({
                        error: 'NodeBB session not found',
                        message: 'Please log in again'
                    });
                }

                // Make request with existing session data - use direct reference to nodeBB
                const response = await nodeBB.makeRequest(
                    req.method,
                    nodeBBPath,
                    ['POST', 'PUT', 'PATCH'].includes(req.method) ? req.body : null,
                    req.session
                );

                // Return the response without overwriting cookie
                delete response.headers['set-cookie']; // Remove cookie headers completely
                res.status(response.status).send(response.data);
            } catch (error) {
                console.error('NodeBB proxy error:', error);
                if (error.response) {
                    return res.status(error.response.status).json({
                        error: 'NodeBB request failed',
                        status: error.response.status,
                        details: error.response.data
                    });
                }
                next(error);
            }
        });

        return router;
    }
};

module.exports = { nodeBB, getNodeBBServiceUrl };