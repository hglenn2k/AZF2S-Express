// Session validation middleware
const validateSession = async (req, res, next) => {
    if (!req.session || !req.session.passport || !req.session.passport.user) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    req.uid = req.session.passport.user;
    return next();
};

// Admin session validation middleware
const validateAdminSession = async (req, res, next) => {
    // Check if session data exists
    if (!req.session || !req.session.passport || !req.session.passport.user) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    try {
        // Get uid from the session
        const uid = req.session.passport.user;

        // Fetch admin and mod data
        const adminResponse = await fetch(
            `${process.env.DOMAIN}${process.env.FORUM_PROXY_ROUTE}/api/admin/manage/admins-mods`,
            {
                credentials: "include",
                headers: {
                    Cookie: req.headers.cookie,
                },
            }
        );

        if (!adminResponse.ok) {
            return res.status(403).json({ error: "Unable to fetch admin data" });
        }

        const adminData = await adminResponse.json();

        // Check if user is an admin
        const isAdmin = adminData.admins.members.some((admin) => admin.uid === uid);

        if (isAdmin) {
            return next();
        } else {
            return res
                .status(403)
                .json({ error: "You need to be an administrator to do that" });
        }
    } catch (err) {
        // Use a proper logging mechanism in production instead of console.error
        console.error(err);
        return res.status(500).json({ error: "Error validating session" });
    }
};

exports.validateSession = validateSession;
exports.validateAdminSession = validateAdminSession;