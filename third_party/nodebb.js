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

                if (!getUserResponse.data || !getUserResponse.data.response) {
                    console.error("GetUser API returned unexpected data format:", JSON.stringify(getUserResponse.data, null, 2));
                    throw new Error("Invalid user data response format");
                }

                userData = getUserResponse.data.response;
                console.log("User data successfully retrieved with admin status:", userData.groupTitleArray?.includes("administrators"));
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
    }
};

module.exports = {
    nodeBB,
    getNodeBBServiceUrl
};