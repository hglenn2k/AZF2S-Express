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

    // Add _uid: 1 to all non-GET requests when using admin Bearer token
    if (config.method && config.method.toLowerCase() !== 'get') {
        // Create data object if it doesn't exist
        if (!config.data) {
            config.data = { _uid: 1 };
        }
        // If data is already an object, add _uid to it
        else if (typeof config.data === 'object' && !Array.isArray(config.data)) {
            if (!config.data._uid) {
                config.data._uid = 1;
            }
        }
        // If data is not an object (string, FormData, etc.), don't modify it
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

module.exports = { nodeBB, getNodeBBServiceUrl };