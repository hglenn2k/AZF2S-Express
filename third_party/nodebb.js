const axios = require('axios');
const express = require('express');

const nodeBB = (() => {
    let nodeBBServiceUrl;
    const getUrl = () => {
        if (!nodeBBServiceUrl) {
            nodeBBServiceUrl = process.env.NODEBB_SERVICE_URL;
        }
        return nodeBBServiceUrl;
    };

    const api = axios.create({ baseURL: getUrl()});
    api.interceptors.response.use(
        response => {
            console.log(`NodeBB API: ${response.config.method.toUpperCase()} ${response.config.url} - ${response.status}`);
            return response;
        },
        error => {
            if (error.response) {
                console.error("NodeBB API error:", error.response.status, error.response.data);
            }
            return Promise.reject(error);
        }
    );

    // Return the public interface
    return {
        api,
        async initializeNodeBBSession(username, password) {
            try {
                // 1. Get initial session and CSRF token
                const configResponse = await api.get(`${getUrl()}/api/config`);

                const csrfToken = configResponse.data?.csrf_token;
                if (!csrfToken) {
                    throw new Error('Could not retrieve CSRF token');
                }

                // Extract session cookie
                const cookies = configResponse.headers['set-cookie'];
                if (!cookies?.length) {
                    throw new Error('No session cookie received');
                }

                const sessionCookie = cookies.find(cookie => cookie.includes('express.sid'));
                if (!sessionCookie) {
                    throw new Error('Session cookie not found');
                }

                // 2. Login with session cookie and CSRF token
                const loginResponse = await api.post(
                    `${getUrl()}/api/v3/utilities/login`,
                    { username, password },
                    {
                        headers: {
                            'Cookie': sessionCookie,
                            'X-CSRF-Token': csrfToken
                        }
                    }
                );

                if (!(loginResponse.data?.status?.code === "ok")) {
                    throw new Error('NodeBB authentication failed');
                }

                // Get cookies after authentication (use new ones if available)
                const authCookies = loginResponse.headers['set-cookie'] || [sessionCookie];

                return {
                    success: true,
                    userData: loginResponse.data.response,
                    csrfToken: csrfToken,
                    sessionCookie: authCookies.join('; ')
                };
            } catch (error) {
                console.error('NodeBB authentication failed:', error);
                throw error;
            }
        },

        createProxyRouter() {
            const router = express.Router({ mergeParams: true });

            router.all('*', async (req, res, next) => {
                try {
                    const nodeBBPath = req.path.replace(/^\/+/, '');
                    console.log(`Proxying to NodeBB: ${req.method} ${nodeBBPath}`);

                    // Setup headers
                    const headers = {};
                    if (req.headers.cookie) {
                        headers['Cookie'] = req.headers.cookie;
                    }

                    // Get CSRF token from session
                    if (req.session && req.session.csrfToken) {
                        headers['X-CSRF-Token'] = req.session.csrfToken;
                    }

                    // Make request
                    const response = await api({
                        method: req.method,
                        url: `${getUrl()}/${nodeBBPath}`,
                        headers,
                        data: ['POST', 'PUT', 'PATCH'].includes(req.method) ? req.body : undefined,
                        params: !['POST', 'PUT', 'PATCH'].includes(req.method) ? req.query : undefined,
                        withCredentials: true
                    });

                    // Forward cookies and response
                    if (response.headers['set-cookie']) {
                        res.set('Set-Cookie', response.headers['set-cookie']);
                    }
                    res.status(response.status).json(response.data);
                } catch (error) {
                    console.error('NodeBB proxy error:', error);

                    if (error.response) {
                        if ([401, 403].includes(error.response.status)) {
                            console.log('Session likely expired - user needs to re-login');
                        }
                        return res.status(error.response.status).json(error.response.data);
                    }
                    next(error);
                }
            });

            return router;
        }    };
})();

module.exports = { nodeBB };