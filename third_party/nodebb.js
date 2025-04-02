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
        // Use provided session token or get new one with existing cookies
        const token = config.sessionToken || (await getCsrfToken(config.sessionCookies)).token;

        config.headers = {
            ...config.headers,
            'X-CSRF-Token': token
        };

        if (config.sessionCookies) {
            config.headers.Cookie = Array.isArray(config.sessionCookies)
                ? config.sessionCookies.join('; ')
                : config.sessionCookies;
        }

        return config;
    } catch (error) {
        console.error("Error in request interceptor:", error);
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

    createProxyRouter() {
        const express = require('express');
        const router = express.Router();

        router.use(async (req, res, next) => {
            if (!req.isAuthenticated()) {
                return res.status(401).json({ error: 'Authentication required' });
            }

            try {
                if (!req.session?.nodeBB?.cookies?.[0]) {
                    console.log('NodeBB session not found');
                    return res.status(401).json({
                        error: 'NodeBB session not found',
                        message: 'Please log in again'
                    });
                }

                const response = await this.makeRequest(
                    req.method,
                    req.path.replace(/^\/+/, ''),
                    ['POST', 'PUT', 'PATCH'].includes(req.method) ? req.body : null,
                    req.session
                );

                // Only save session if cookies changed
                if (response.headers['set-cookie']) {
                    const newSessionCookie = response.headers['set-cookie'].find(
                        cookie => cookie.startsWith('express.sid=')
                    );
                    if (newSessionCookie && newSessionCookie !== req.session.nodeBB.cookies[0]) {
                        req.session.nodeBB.cookies = [newSessionCookie];
                        await new Promise((resolve, reject) => {
                            req.session.save(err => err ? reject(err) : resolve());
                        });
                    }
                }

                res.status(response.status).send(response.data);
            } catch (error) {
                next(error);
            }
        });

        return router;
    }
};

module.exports = { nodeBB, getNodeBBServiceUrl };