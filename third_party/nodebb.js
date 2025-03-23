const axios = require('axios');

class NodeBBError extends Error {
    constructor(message, statusCode = 500, details = null) {
        super(message);
        this.name = 'NodeBBError';
        this.statusCode = statusCode;
        this.details = details;
    }
}

const nodeBB = {
    async initializeNodeBBSession(username, password) {
        try {
            // First get the CSRF token from /api/config
            const configResponse = await axios.get(
                `${process.env.PROTOCOL}${process.env.DOMAIN}/api/nodebb/api/config`,
                { withCredentials: true }
            );

            const csrfToken = configResponse.data?.csrf_token;
            if (!csrfToken) {
                throw new NodeBBError('CSRF token not found in NodeBB response', 502);
            }

            // Now login to NodeBB with the CSRF token
            const loginResponse = await axios.post(
                `${process.env.PROTOCOL}${process.env.DOMAIN}/api/nodebb/api/v3/utilities/login`,
                {
                    username: username,
                    password: password,
                },
                {
                    headers: {
                        'X-CSRF-Token': csrfToken,
                        Authorization: `Bearer ${process.env.NODEBB_BEARER_TOKEN}`
                    },
                    withCredentials: true
                }
            );

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
                `${process.env.PROTOCOL}${process.env.DOMAIN}/api/nodebb/api/config`,
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

module.exports = nodeBB;