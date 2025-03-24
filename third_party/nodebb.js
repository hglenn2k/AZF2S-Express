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
                consolg.log("No csrf token found");
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

            if (!loginResponse.data?.success) {
                throw new NodeBBError(
                    'NodeBB authentication failed',
                    401,
                    loginResponse.data
                );
            }

            return {
                success: true,
                cookies: loginResponse.headers['set-cookie'],
                csrfToken: csrfToken,
                userData: loginResponse.data.user
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
    }
};

module.exports = {
    nodeBB,
    getNodeBBServiceUrl
};