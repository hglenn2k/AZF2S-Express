const axios = require('axios');

class NodeBBError extends Error {
    constructor(message, statusCode = 500, details = null) {
        super(message);
        this.name = 'NodeBBError';
        this.statusCode = statusCode;
        this.details = details;
    }
}

// Cache the NodeBB service URL
let nodeBBServiceUrl;
function getNodeBBServiceUrl() {
    if (!nodeBBServiceUrl) {
        nodeBBServiceUrl = process.env.NODEBB_SERVICE_URL || `${process.env.PROTOCOL}${process.env.DOMAIN}${process.env.FORUM_PROXY_ROUTE}`;
    }
    return nodeBBServiceUrl;
}

// Create a custom Axios instance for NodeBB API requests
const nodeBBAxios = axios.create({
    baseURL: getNodeBBServiceUrl()
});

// Add Bearer token and _uid to all requests
nodeBBAxios.interceptors.request.use(async (config) => {
    // Always add Bearer token
    config.headers = {
        ...config.headers,
        'Authorization': `Bearer ${process.env.NODEBB_BEARER}`
    };

    // Handle _uid parameter based on request method
    if (config.method && config.method.toLowerCase() === 'get') {
        // For GET requests, add _uid as query parameter
        config.params = config.params || {};
        config.params._uid = 1;
    } else {
        // For non-GET requests, add _uid to the body
        if (!config.data) {
            config.data = { _uid: 1 };
        } else if (typeof config.data === 'object' && !Array.isArray(config.data)) {
            if (!config.data._uid) {
                config.data._uid = 1;
            }
        }
    }

    return config;
});

// Add response interceptor to log responses
nodeBBAxios.interceptors.response.use(
    (response) => {
        console.log(`NodeBB API response success: ${response.config.method.toUpperCase()} ${response.config.url} - Status: ${response.status}`);
        return response;
    },
    async (error) => {
        if (error.response) {
            console.error("NodeBB API error:", error.response.status, error.response.data);
        }
        return Promise.reject(error);
    }
);

const nodeBB = {
    async makeRequest(method, url, data = null) {
        const config = {
            method,
            url
        };

        if (data && method.toLowerCase() !== 'get') {
            config.data = data;
        }

        return this.api(config);
    },

    api: nodeBBAxios,

    async initializeNodeBBSession(username, password) {
        try {
            console.log("Authenticating user with NodeBB");

            // Login to NodeBB with Bearer token
            const loginResponse = await this.api({
                method: 'post',
                url: '/api/v3/utilities/login',
                data: { username, password }
            });

            if (!(loginResponse.data?.status?.code === "ok")) {
                throw new NodeBBError('NodeBB authentication failed', 401);
            }

            // Get user data using Bearer token
            const getUserResponse = await this.api({
                method: 'get',
                url: `/api/user/username/${username}`
            });

            if (!getUserResponse.data?.uid) {
                throw new NodeBBError('Invalid user data response', 500);
            }

            return {
                success: true,
                userData: getUserResponse.data
            };
        } catch (error) {
            console.error('NodeBB authentication failed:', error);
            throw error;
        }
    },

    async verifyNodeBBHealth() {
        try {
            const response = await axios.get(`${getNodeBBServiceUrl()}/api/config`, {
                timeout: 5000,
                headers: {
                    'Authorization': `Bearer ${process.env.NODEBB_BEARER}`
                }
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
    }
};

const createProxyRouter = () => {
    const express = require('express');
    const router = express.Router();

    // Handle all HTTP methods
    router.all('*', async (req, res, next) => {
        try {
            // Get the path after the proxy route
            const nodeBBPath = req.path.replace(/^\/+/, '');
            console.log(`Proxying to NodeBB: ${req.method} ${nodeBBPath}`);

            // Determine if we need to send body data
            const hasBody = ['POST', 'PUT', 'PATCH'].includes(req.method);

            // Forward the request to NodeBB using our makeRequest helper
            const response = await nodeBB.makeRequest(
                req.method,
                nodeBBPath,
                hasBody ? req.body : null
            );

            // Send the response back to the client
            res.status(response.status).json(response.data);
        } catch (error) {
            console.error('NodeBB proxy error:', error);

            // Handle API errors
            if (error.response) {
                return res.status(error.response.status).json(error.response.data);
            }

            // Handle other errors
            next(error);
        }
    });

    return router;
};

nodeBB.createProxyRouter = createProxyRouter;

module.exports = { nodeBB, getNodeBBServiceUrl };