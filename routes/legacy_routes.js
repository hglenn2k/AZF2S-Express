// legacy_routes.js
const { google } = require("googleapis");
const axios = require("axios");
const { validateSession, validateAdminSession } = require('../middleware/validateSession');
const dayjs = require("dayjs");
const {ObjectId} = require("mongodb");
const {getNodeBBServiceUrl} = require("../third_party/nodebb");

const mongoEnv = process.env.MONGO_NODEBB_DATABASE || 'nodebb';

/**
 * Setup Legacy Routes
 * @param {Object} app - Express app instance
 * @param {Object} options - Configuration options
 * @param {Object} options.jwtClient - Google JWT client
 * @param {string} options.spreadsheetId - Google spreadsheet ID
 * @param {string} options.range - Google spreadsheet range
 * @param {Object} options.mongoClient - MongoDB client
 */
function setupLegacyRoutes(app, { jwtClient, spreadsheetId, range, mongoClient }) {

    app.post("/append", validateSession, async (req, res) => {
        try {
            const values = req.body.values;

            await jwtClient.authorize();
            const sheets = google.sheets({ version: "v4", auth: jwtClient });

            const response = await sheets.spreadsheets.values.append({
                spreadsheetId: spreadsheetId,
                range: range,
                valueInputOption: "RAW",
                insertDataOption: "INSERT_ROWS",
                resource: {
                    values: [values],
                },
            });

            res.json({ message: "Data appended", data: response.data });
        } catch (error) {
            res.status(500).json({ message: `An error occurred: ${error}` });
        }
    });

    app.post("/fetch-headers", async (req, res) => {
        const { fetchedResources } = req.body;

        const fetchHeaders = async (resource) => {
            try {
                const response = await axios.head(resource.Link);
                return { resource, headers: response.headers };
            } catch (error) {
                console.error(
                    `Error fetching headers for ${resource.Link}: ${error.message}`
                );
                return { resource, error: error.message };
            }
        };

        const results = await Promise.all(fetchedResources.map(fetchHeaders));
        res.json(results);
    });

    app.put("/user", validateSession, async (req, res) => {
        const userId = req.uid;
        const userKey = `user:${userId}`;
        const updateData = req.body;

        try {
            await mongoClient.connect();
            const database = mongoClient.db(mongoEnv);
            const collection = database.collection("objects");

            const result = await collection.updateOne(
                { _key: userKey },
                { $set: updateData }
            );

            if (result.matchedCount > 0) {
                const updatedUser = await collection.findOne({ _key: userKey });
                res
                    .status(200)
                    .json({ message: "User updated successfully", user: updatedUser });
            } else {
                res.status(404).json({ message: "User not found" });
            }
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Error updating user" });
        }
    });

    app.get("/isAdmin", validateAdminSession, (req, res) => {
        res.status(200);
    });

    app.put("/submit-form", validateSession, async (req, res) => {
        const userId = req.uid;
        const userKey = `user:${userId}`;
        let updateData = req.body.user;

        updateData.memberstatus = "pending";
        updateData.showlocation = true;
        updateData.appearonmap = true;
        updateData.appearoncontactlist = true;

        try {
            await mongoClient.connect();
            const database = mongoClient.db(mongoEnv);
            const usersCollection = database.collection("objects");

            // Update User
            const userResult = await usersCollection.updateOne(
                { _key: userKey },
                { $set: updateData }
            );

            if (userResult.matchedCount > 0) {
                const updatedUser = await usersCollection.findOne({ _key: userKey });
                res.status(200).json({
                    message: "User and organizations updated successfully",
                    user: updatedUser,
                });
            } else {
                res.status(404).json({ message: "User not found" });
            }
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Error updating user and organizations" });
        }
    });

    app.put("/renew-membership", validateSession, async (req, res) => {
        const userId = req.uid;
        const userKey = `user:${userId}`;
        let updateData = req.body.user;

        // Add the memberStatus to the updateData
        updateData.memberstatus = "pending";
        updateData.renewdate = dayjs().add(1, "year");

        try {
            await mongoClient.connect();
            const database = mongoClient.db(mongoEnv);
            const usersCollection = database.collection("objects");

// Update User
            const userResult = await usersCollection.updateOne(
                { _key: userKey },
                { $set: updateData }
            );

            if (userResult.matchedCount > 0) {
                const updatedUser = await usersCollection.findOne({ _key: userKey });
                res.status(200).json({
                    message: "User and organizations updated successfully",
                    user: updatedUser,
                });
            } else {
                res.status(404).json({ message: "User not found" });
            }
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Error updating user and organizations" });
        }
    });

    app.get("/user-settings", validateSession, async (req, res) => {
        const userId = req.uid;
        const userKey = `user:${userId}:settings`;

        try {
            await mongoClient.connect();
            const database = mongoClient.db(mongoEnv);
            const collection = database.collection("objects");

            const userSettings = await collection.findOne({ _key: userKey });

            if (userSettings) {
                res.status(200).json(userSettings);
            } else {
                res.status(404).json({ message: "User settings not found" });
            }
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Error connecting to the database" });
        }
    });

    app.put("/user-settings", validateSession, async (req, res) => {
        const userId = req.uid;
        console.log(userId);

        console.log(req.body);
        try {
            await axios.put(
                `${getNodeBBServiceUrl()}/api/v3/users/` + userId + "/settings",
                {
                    settings: {
                        showemail: req.body.showemail.toString(),
                        showfullname: req.body.showfullname.toString(),
                    },
                },
                {
                    headers: {
                        Authorization: "Bearer " + process.env.NODEBB_BEARER,
                    },
                }
            );
        } catch (error) {
            res.status(500).json({ message: "Error updating user settings" });
        }
    });

    app.get("/notifications", validateSession, async (req, res) => {
        try {
            const response = await axios.get(
                `${getNodeBBServiceUrl()}/api/notifications`,
                {
                    headers: {
                        Cookie: req.headers.cookie,
                    },
                }
            );

            let chatNotificationCount = response.data.notifications?.filter(
                (notification) =>
                    notification.type === "new-chat" && notification.read === false
            ).length;

            res.json({ chat_notifications_count: chatNotificationCount });
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Error retrieving notifications" });
        }
    });

    app.get("/about", async (req, res) => {
        const spreadsheetId = "1ZDgVdMu75baR1z8m8QK3ti-ZO4KIrQmw244VSKt3S6c";
        const tabName = "People";
        const apiKey = process.env.GOOGLE_SHEETS_API_KEY;

        const url =
            "https://sheets.googleapis.com/v4/spreadsheets/" +
            spreadsheetId +
            "/values/" +
            tabName +
            "?alt=json&key=" +
            apiKey;

        try {
            let response = await fetch(url);
            let data = await response.json();
            const output = data.values;
            const categories = output[0];
            const bios = output.map((bio) =>
                categories.reduce(
                    (obj, key, index) => ({ ...obj, [key]: bio[index] }),
                    {}
                )
            );
            res.json(bios);
        } catch (err) {
            res.status(500).json({ message: err.toString() });
        }
    });

    app.get("/calendar", async (req, res) => {
        const spreadsheetId = "1RnFunyp964dHo4bxBpadqWa3NOK0Ycvaw5sfi1frxms";
        const tabName = "Events";
        const apiKey = process.env.GOOGLE_SHEETS_API_KEY;

        const url =
            "https://sheets.googleapis.com/v4/spreadsheets/" +
            spreadsheetId +
            "/values/" +
            tabName +
            "?alt=json&key=" +
            apiKey;

        try {
            let response = await fetch(url);
            let data = await response.json();
            const output = data.values;
            const categories = output[0];
            const events = output.map((event) =>
                categories.reduce(
                    (obj, key, index) => ({ ...obj, [key]: event[index] }),
                    {}
                )
            );
            res.json(events);
        } catch (err) {
            res.status(500).json({ message: err.toString() });
        }
    });

    app.get("/faq", async (req, res) => {
        const spreadsheetId = "1SV7r85mu_yhLPks3Nfy2d_BcQYGYK9qmKXbHYo2loRc";
        const tabName = "Questions";
        const apiKey = process.env.GOOGLE_SHEETS_API_KEY;

        const url =
            "https://sheets.googleapis.com/v4/spreadsheets/" +
            spreadsheetId +
            "/values/" +
            tabName +
            "?alt=json&key=" +
            apiKey;

        try {
            let response = await fetch(url);
            let data = await response.json();
            const output = data.values;
            const categories = output[0];
            const questions = output.map((question) =>
                categories.reduce(
                    (obj, key, index) => ({ ...obj, [key]: question[index] }),
                    {}
                )
            );
            res.json(questions);
        } catch (err) {
            res.status(500).json({ message: err.toString() });
        }
    });

    app.get("/map-data", async (req, res) => {
        try {
            await mongoClient.connect();
            const database = mongoClient.db(mongoEnv);
            const orgsCollection = database.collection("organizations");

            const organizations = await orgsCollection.find().toArray();

            res.json(organizations);
        } catch (error) {
            console.error(error);
            res.status(500).send("Error occurred while fetching data");
        }
    });

    app.get("/location-filters", async (req, res) => {
        const spreadsheetId = "10Cc6iblTC3BAltl0479euAr_4v3Zx-saS0Ty8c4PcKQ";
        const tabName = "Profile Tags";
        const apiKey = process.env.GOOGLE_SHEETS_API_KEY;

        const url =
            "https://sheets.googleapis.com/v4/spreadsheets/" +
            spreadsheetId +
            "/values/" +
            tabName +
            "?alt=json&key=" +
            apiKey;

        try {
            let response = await fetch(url);
            let data = await response.json();
            const output = data.values;
            output.shift();
            const organizedTags = {
                siteTags: [],
                userTags: [],
            };

            output.forEach((tagRow) => {
                const [siteTagName, siteTagDescription, userTagName, userTagDescription] =
                    tagRow;

                if (siteTagName && siteTagName !== "") {
                    organizedTags.siteTags.push({
                        tagName: siteTagName,
                        description: siteTagDescription,
                    });
                }

                if (userTagName && userTagName !== "") {
                    organizedTags.userTags.push({
                        tagName: userTagName,
                        description: userTagDescription,
                    });
                }
            });

            res.json(organizedTags);
        } catch (err) {
            console.log(err);
            res.status(500).json({ message: err.toString() });
        }
    });

    app.get("/communities-of-practice", async (req, res) => {
        const spreadsheetId = "1bwVvs64UELc_GU94NhmNcgLSGdRAU3G6iHsHCgqt6wI";
        const tabName = "COP";
        const apiKey = process.env.GOOGLE_SHEETS_API_KEY;

        const url =
            "https://sheets.googleapis.com/v4/spreadsheets/" +
            spreadsheetId +
            "/values/" +
            tabName +
            "?alt=json&key=" +
            apiKey;

        try {
            let response = await fetch(url);
            let data = await response.json();
            const output = data.values;
            const COP = output.flat();
            res.json(COP);
        } catch (err) {
            console.log(err);
            res.status(500).json({ message: err.toString() });
        }
    });

    app.get("/resources", async (req, res) => {
        const spreadsheetId = "1khoNt12y2nRQQF-9dB3OILUXyvGQkSvl_WLgfODEAsY";
        const tabName = "Resources Compiled";
        const apiKey = process.env.GOOGLE_SHEETS_API_KEY;

        const url =
            "https://sheets.googleapis.com/v4/spreadsheets/" +
            spreadsheetId +
            "/values/" +
            tabName +
            "?alt=json&key=" +
            apiKey;

        try {
            let response = await fetch(url);
            let data = await response.json();
            const output = data.values.map((row) =>
                row.filter((cell, index) => (index % 2 !== 0))
            );
            const categories = output[0];
            const resources = output
                .slice(3)
                .map((resource) =>
                    categories.reduce(
                        (obj, key, index) => ({ ...obj, [key]: resource[index] }),
                        {}
                    )
                );
            res.json(resources);
        } catch (err) {
            res.status(500).json({ message: err.toString() });
        }
    });

    app.post("/contact-list-users", async (req, res) => {
        //Base search params will find only user accounts with the settings object
        const jsonSearchParams = {
            appearoncontactlist: true,
            memberstatus: "verified",
        };

        try {
            await mongoClient.connect();
            const database = mongoClient.db(mongoEnv);
            const collection = database.collection("objects");

            const result = await collection.find(jsonSearchParams).toArray();

            const filteredMembers = result.filter((user) => {
                if (user.renewdate) {
                    const renewDate = dayjs(user.renewdate);
                    return dayjs().isBefore(renewDate);
                } else {
                    return false;
                }
            });

            const memberUids = filteredMembers.map((user) => user.uid);

            // Create an array of keys for fetching user settings
            const userSettingsKeys = memberUids.map((uid) => `user:${uid}:settings`);

            // Fetch settings for these users
            const userSettings = await collection
                .find({ _key: { $in: userSettingsKeys } })
                .toArray();

            const mergedData = filteredMembers.map((member) => {
                const memberSettings = userSettings.find(
                    (setting) => setting._key === `user:${member.uid}:settings`
                );
                return {
                    ...member,
                    settings: memberSettings ? memberSettings : {},
                };
            });

            //Return user data as JSON string
            res.status(200).json({ response: JSON.stringify(mergedData) });
        } catch (error) {
            console.log(error);
            res.status(500).json({ message: "Error finding users" });
        }
    });

    app.post("/get-organization-members", async (req, res) => {
        try {
            await mongoClient.connect();
            const database = mongoClient.db(mongoEnv);
            const collection = database.collection("organizations");
            const userCollection = database.collection("objects");

            // Get the orgId from the request body
            const { orgId } = req.body;
            const _id = new ObjectId(orgId);

            // Fetch the organization to get member UIDs
            const organization = await collection.findOne({ _id: _id });

            const memberUids = organization.members.map((member) => member.uid);

            // Define the conditions for the query
            const query = {
                uid: { $in: memberUids },
                appearonmap: true,
            };

            // Fetch user details using the member UIDs and the conditions
            const membersDetails = await userCollection.find(query).toArray();

            const filteredMembers = membersDetails.filter((user) => {
                const renewDate = dayjs(user.renewdate);
                return dayjs().isBefore(renewDate);
            });

            res.status(200).json(filteredMembers);
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Internal Server Error" });
        }
    });

    app.post("/send-contact-email", async (req, res) => {
        const fullName = req.body.fullName;
        const email = req.body.email;
        const comments = req.body.comments;

        let current = new Date();
        let cDate =
            current.getFullYear() +
            "-" +
            (current.getMonth() + 1) +
            "-" +
            current.getDate();
        let cTime =
            current.getHours() +
            ":" +
            current.getMinutes() +
            ":" +
            current.getSeconds();
        let dateTime = cDate + " " + cTime;

        let info = await req.app.local.transporter.sendMail({
            from: '"[Contact-Us]" <contact-us@azfarmtoschool.org>',
            to: "contact@azfarmtoschool.org",
            subject: "New Contact-Us Message",
            html:
                "<html lang='en'><body><br><table style='border:0; vertical-align:top;'><tr><td valign='top'><strong>Name : </strong></td><td>" +
                fullName +
                "</td></tr><tr><td valign='top'><strong>Email: </strong></td><td>" +
                email +
                "</td></tr><tr><td  valign='top'><strong>Timestamp: </strong></td><td>" +
                dateTime +
                "</td></tr><tr><td  valign='top'><strong>Questions/Comments: </strong></td><td>" +
                comments +
                "</td></tr></table></body></html>",
        });

        res.send(info);
    });

    async function addUserToGroups(req, userId, groups) {
        const userKey = `user:${userId}`;

        const configResponse = await axios.get(
            `${getNodeBBServiceUrl()}/api/config`,
            {
                headers: {
                    "Content-Type": "application/json",
                    Cookie: req.headers.cookie,
                },
            }
        );

        const csrfToken = configResponse.data.csrf_token;

        const groupSlugs = groups.map((group) =>
            group.toLowerCase().replace(/\s+/g, "-")
        );

        const groupAddPromises = groupSlugs.map((groupSlug) => {
            return fetch(
                `${getNodeBBServiceUrl()}/api/v3/groups/${groupSlug}/membership/${userId}`,
                {
                    method: "PUT",
                    headers: {
                        Accept: "application/json",
                        "Content-Type": "application/json",
                        "X-CSRF-Token": csrfToken,
                        Cookie: req.headers.cookie,
                    },
                    credentials: "include",
                }
            )
                .then((response) => {
                    if (!response.ok) {
                        throw new Error(
                            `Error adding user to group ${groupSlug}: ${response.statusText}`
                        );
                    }
                })
                .catch((error) => {
                    console.log(error);
                });
        });

        await mongoClient.connect();
        const database = mongoClient.db(mongoEnv);
        const collection = database.collection("objects");

        const user = await collection.findOne({ _key: userKey });

        // convert the groupTitle string back to an array
        let currentGroups = JSON.parse(user.groupTitle || "[]");

        if (currentGroups[0] === "") {
            currentGroups = [];
        }

        // combine currentGroups and newGroups into one array, filtering out duplicates
        const updatedGroups = Array.from(new Set([...currentGroups, ...groups]));

        // convert updatedGroups back to a string
        const updatedGroupTitle = JSON.stringify(updatedGroups);

        // update groupTitle in the database
        const updateResult = await collection.updateOne(
            { _key: userKey },
            { $set: { groupTitle: updatedGroupTitle, groups: groups } }
        );

        // handle result of update operation
        if (updateResult.modifiedCount !== 1) {
            console.error("Failed to update groupTitle for user", userKey);
        }

        await Promise.all(groupAddPromises);
    }

    async function removeUserFromGroups(req, userId, groups) {
        const userKey = `user:${userId}`;

        const configResponse = await axios.get(
            `${getNodeBBServiceUrl()}/api/config`,
            {
                headers: {
                    "Content-Type": "application/json",
                    Cookie: req.headers.cookie,
                },
            }
        );

        const csrfToken = configResponse.data.csrf_token;

        const groupSlugs = groups.map((group) =>
            group.toLowerCase().replace(/\s+/g, "-")
        );

        const groupAddPromises = groupSlugs.map((groupSlug) => {
            return fetch(
                `${getNodeBBServiceUrl()}/api/v3/groups/${groupSlug}/membership/${userId}`,
                {
                    method: "DELETE",
                    headers: {
                        Accept: "application/json",
                        "Content-Type": "application/json",
                        "x-csrf-token": csrfToken,
                        Cookie: req.headers.cookie,
                    },
                }
            ).then((response) => {
                if (!response.ok) {
                    throw new Error(
                        `Error removing user to group ${groupSlug}: ${response.statusText}`
                    );
                }
            });
        });

        await mongoClient.connect();
        const database = mongoClient.db(mongoEnv);
        const collection = database.collection("objects");

        const user = await collection.findOne({ _key: userKey });

        // convert the groupTitle string back to an array
        const currentGroups = JSON.parse(user.groupTitle || "[]");

        // filter out the groups that should be removed
        const updatedGroups = currentGroups.filter(
            (group) => !groups.includes(group) && group !== "Network Member"
        );

        // convert updatedGroups back to a string
        const updatedGroupTitle = JSON.stringify(updatedGroups);

        // update groupTitle in the database
        const updateResult = await collection.updateOne(
            { _key: userKey },
            { $set: { groupTitle: updatedGroupTitle } }
        );

        // handle result of update operation
        if (updateResult.modifiedCount !== 1) {
            console.error("Failed to update groupTitle for user", userKey);
        }

        await Promise.all(groupAddPromises);
    }

    app.put("/accept-membership", validateAdminSession, async (req, res) => {
        const userId = req.body.userId; // Get userId from request body
        const userKey = `user:${userId}`;

        try {
            await mongoClient.connect();
            const database = mongoClient.db(mongoEnv);
            const collection = database.collection("objects");
            const orgsCollection = database.collection("organizations");

            const user = await collection.findOne({ _key: userKey });

            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            // Add user to groups in NodeBB
            await addUserToGroups(req, userId, [...user.groups, "Network Member"]);

            const currentMembershipDate = user.membershipdate || dayjs().toString();
            const currentRenewDate =
                user.renewdate || dayjs().add(1, "year").toString();
            const isRecentlyVerified =
                !user.membershipdate || dayjs().isAfter(renewdate);

            const updateQuery = {
                $set: {
                    memberstatus: "verified",
                    membershipdate: currentMembershipDate,
                    renewdate: currentRenewDate,
                    recentlyverified: isRecentlyVerified,
                },
            };
            await collection.updateOne({ _key: userKey }, updateQuery);
            // Get organization ids from user's organizations array
            const orgIds = user.organizations.map((org) => new ObjectId(org._id));

            // Update organizations' members array
            await orgsCollection.updateMany(
                { _id: { $in: orgIds } },
                { $addToSet: { members: { uid: userId, name: user.fullname } } }
            );

            const updatedUser = await collection.findOne({ _key: userKey });
            res
                .status(200)
                .json({ message: "User verified successfully", user: updatedUser });
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Error verifying user" });
        }
    });

    app.put("/deny-membership", validateAdminSession, async (req, res) => {
        const userId = req.body.userId; // Get userId from request body
        const userKey = `user:${userId}`;

        try {
            await mongoClient.connect();
            const database = mongoClient.db(mongoEnv);
            const collection = database.collection("objects");

            const user = await collection.findOne({ _key: userKey });

            if (user.memberstatus === "verified") {
                await removeUserFromGroups(req, userId, [
                    ...user.groups,
                    "Network Member",
                ]);
            }

            const result = await collection.updateOne(
                { _key: userKey },
                {
                    $set: { memberstatus: "unverified" },
                    $unset: {
                        groups: [],
                        tags: [],
                        organizations: [],
                        county: "",
                        city: "",
                        communitiesofpractice: [],
                        hopetogain: [],
                        othergains: "",
                        additionalcomments: "",
                    },
                }
            );

            if (result.matchedCount > 0) {
                const updatedUser = await collection.findOne({ _key: userKey });
                res
                    .status(200)
                    .json({ message: "User denied successfully", user: updatedUser });
            } else {
                res.status(404).json({ message: "User not found" });
            }
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Error denying user" });
        }
    });

    app.put("/delete-membership", validateSession, async (req, res) => {
        const userId = req.uid;
        const userKey = `user:${userId}`;

        try {
            await mongoClient.connect();
            const database = mongoClient.db(mongoEnv);
            const collection = database.collection("objects");

            const user = await collection.findOne({ _key: userKey });

            // TODO: Clean the slate for next membership.
            await removeUserFromGroups(req, userId, [...user.groups, "Network Member"]);

            const result = await collection.updateOne(
                { _key: userKey },
                {
                    $set: { memberstatus: "unverified" },
                    $unset: {
                        groups: [],
                        tags: [],
                        organizations: [],
                        county: "",
                        city: "",
                        communitiesofpractice: [],
                        hopetogain: [],
                        othergains: "",
                        additionalcomments: "",
                    },
                }
            );

            if (result.matchedCount > 0) {
                const updatedUser = await collection.findOne({ _key: userKey });
                res
                    .status(200)
                    .json({ message: "User denied successfully", user: updatedUser });
            } else {
                res.status(404).json({ message: "User not found" });
            }
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Error denying user" });
        }
    });

    async function geocodeAddress(address) {
        const baseUrl = "https://nominatim.openstreetmap.org/search";
        const params = new URLSearchParams({
            q: address,
            format: "json",
            limit: 1,
        });

        const requestOptions = {
            method: "GET",
            headers: {
                "User-Agent": "AZ-Farm-To-School-Network/1.0.0 azfts@gmail.com",
            },
        };

        try {
            const response = await fetch(`${baseUrl}?${params}`, requestOptions);

            if (response.ok) {
                const data = await response.json();
                if (data.length > 0) {
                    return data[0];
                } else {
                    return "No results found for this address.";
                }
            } else {
                return `Error: ${response.status} - ${response.statusText}`;
            }
        } catch (error) {
            return `Error: ${error.message}`;
        }
    }

    app.post("/add-organization", validateSession, async (req, res) => {
        const newOrg = req.body;

        try {
            await mongoClient.connect();
            const database = mongoClient.db(mongoEnv);
            const orgsCollection = database.collection("organizations");

            // Geocode the address
            const geocodeResult = await geocodeAddress(
                newOrg.address + " " + newOrg.city + " AZ " + newOrg.zip
            );

            if (!geocodeResult.lat || !geocodeResult.lon) {
                throw new Error(`Failed to geocode address: ${newOrg.address}`);
            }

            // Set the latLng field
            newOrg.latLng = [
                parseFloat(geocodeResult.lat),
                parseFloat(geocodeResult.lon),
            ];

            // Add 'organizationstatus' to the organization data
            newOrg.organizationstatus = "pending";

            // Insert the organization into the collection
            const result = await orgsCollection.insertOne(newOrg);

            const insertedOrganizationId = result.insertedId;

            // Respond with the inserted organization
            res.status(200).json({
                message: "Organization added successfully",
                orgId: insertedOrganizationId,
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: error.message });
        }
    });

    app.put("/accept-organization", validateAdminSession, async (req, res) => {
        const { organizationId } = req.body;

        try {
            await mongoClient.connect();
            const database = mongoClient.db(mongoEnv);
            const collection = database.collection("organizations");
            const _id = new ObjectId(organizationId);

            const result = await collection.updateOne(
                { _id: _id },
                { $set: { organizationstatus: "verified" } }
            );

            if (result.matchedCount > 0) {
                res.status(200).json({ message: "Organization verified successfully" });
            } else {
                res.status(404).json({ message: "Organization not found" });
            }
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Error verifying organization" });
        }
    });

    app.put("/deny-organization", validateAdminSession, async (req, res) => {
        const { organizationId } = req.body;

        try {
            await mongoClient.connect();
            const database = mongoClient.db(mongoEnv);
            const collection = database.collection("organizations");
            const usersCollection = database.collection("objects");
            const _id = new ObjectId(organizationId);

            const result = await collection.deleteOne({ _id: _id });

            if (result.deletedCount > 0) {
                await usersCollection.updateMany(
                    { "organizations._id": organizationId },
                    { $pull: { organizations: { _id: organizationId } } }
                );
                res.status(200).json({ message: "Organization deleted successfully" });
            } else {
                res.status(404).json({ message: "Organization not found" });
            }
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Error deleting organization" });
        }
    });

    app.put("/edit-organization", validateAdminSession, async (req, res) => {
        const orgID = req.body.organizationId;
        const updateData = req.body.data;

        try {
            await mongoClient.connect();
            const database = mongoClient.db(mongoEnv);
            const collection = database.collection("organizations");
            const _id = new ObjectId(orgID);

            const result = await collection.updateOne(
                { _id: _id },
                { $set: updateData }
            );

            if (result.matchedCount > 0) {
                const updatedOrganization = await collection.findOne({ _id: _id });
                res.status(200).json({
                    message: "Organization updated successfully",
                    organization: updatedOrganization,
                });
            } else {
                res.status(404).json({ message: "Organization not found" });
            }
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Error updating organization" });
        }
    });

    app.put("/remove-member", validateSession, async (req, res) => {
        const userId = req.uid;
        const orgID = req.body.orgId;

        try {
            await mongoClient.connect();
            const database = mongoClient.db(mongoEnv);
            const collection = database.collection("organizations");
            const _id = new ObjectId(orgID);

            const result = await collection.updateOne(
                { _id: _id },
                { $pull: { members: { uid: userId } } }
            );

            if (result.modifiedCount > 0) {
                res.status(200).json({ message: "Member removed successfully" });
            } else {
                res.status(404).json({
                    message: "Organization not found or member not in organization",
                });
            }
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Error removing member" });
        }
    });

    app.get("/pending-members", validateAdminSession, async (req, res) => {
        try {
            await mongoClient.connect();
            const database = mongoClient.db(mongoEnv);
            const collection = database.collection("objects");

            const pendingMembers = await collection
                .find({ memberstatus: "pending" })
                .toArray();

            if (pendingMembers.length > 0) {
                res.status(200).json({
                    message: "Pending members fetched successfully",
                    members: pendingMembers,
                });
            } else {
                res.status(404).json({ message: "No pending members found" });
            }
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Error fetching pending members" });
        }
    });

    app.get("/verified-members", validateAdminSession, async (req, res) => {
        try {
            await mongoClient.connect();
            const database = mongoClient.db(mongoEnv);
            const collection = database.collection("objects");

            const pendingMembers = await collection
                .find({ memberstatus: "verified" })
                .toArray();

            if (pendingMembers.length > 0) {
                res.status(200).json({
                    message: "Verified members fetched successfully",
                    members: pendingMembers,
                });
            } else {
                res.status(404).json({ message: "No verified members found" });
            }
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Error fetching verified members" });
        }
    });

    app.get("/pending-organizations", validateAdminSession, async (req, res) => {
        try {
            await mongoClient.connect();
            const database = mongoClient.db(mongoEnv);
            const collection = database.collection("organizations");

            const pendingOrgs = await collection
                .find({ organizationstatus: "pending" })
                .toArray();

            if (pendingOrgs.length > 0) {
                res.status(200).json({
                    message: "Pending organizations fetched successfully",
                    orgs: pendingOrgs,
                });
            } else {
                res.status(404).json({ message: "No pending organizations found" });
            }
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Error fetching pending organizations" });
        }
    });

    app.get("/verified-organizations", validateSession, async (req, res) => {
        try {
            await mongoClient.connect();
            const database = mongoClient.db(mongoEnv);
            const collection = database.collection("organizations");

            const verifiedOrgs = await collection
                .find({ organizationstatus: "verified" })
                .toArray();

            if (verifiedOrgs.length > 0) {
                res.status(200).json({
                    message: "Verified organizations fetched successfully",
                    orgs: verifiedOrgs,
                });
            } else {
                res.status(404).json({ message: "No verified organizations found" });
            }
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Error fetching verified organizations" });
        }
    });

    app.post("/new-member-request", async (req, res) => {
        const fullName = req.body.fullName;
        const email = req.body.email;
        const username = req.body.username;

        let current = new Date();
        let cDate =
            current.getFullYear() +
            "-" +
            (current.getMonth() + 1) +
            "-" +
            current.getDate();
        let cTime =
            current.getHours() +
            ":" +
            current.getMinutes() +
            ":" +
            current.getSeconds();
        let dateTime = cDate + " " + cTime + " UTC";

        let info = await req.app.local.transporter.sendMail({
            from: '"[New Membership Request]" <new-member@azfarmtoschool.org>',
            to: "support@azfarmtoschool.org",
            cc: "azfarmtoschoolnetwork@gmail.com",
            subject: "New Membership Form Submitted",
            html:
                "<html lang='en'><body><br><table style='border:0; vertical-align:top;'><tr><td valign='top'><strong>Name: </strong></td><td>" +
                fullName +
                "</td></tr><tr><td valign='top'><strong>Username: </strong></td><td>" +
                username +
                "</td></tr><tr><td  valign='top'><strong>Email: </strong></td><td>" +
                email +
                "</td></tr><tr><td  valign='top'><strong>Timestamp: </strong></td><td>" +
                dateTime +
                " UTC</td></tr></table></body></html>",
        });

        res.send(info);
    });

    app.get("/group-colors", async (req, res) => {
        try {
            const response = await axios.get(
                `${getNodeBBServiceUrl()}/api/groups`,
                {
                    withCredentials: false,
                }
            );
            const colors = response.data.groups.reduce((acc, group) => {
                acc[group.name] = group.labelColor;
                return acc;
            }, {});

            // Respond with the group colors
            res.json(colors);
        } catch (error) {
            console.error(error);
            // Send a 500 error in case something goes wrong
            res
                .status(500)
                .json({ error: "An error occurred while retrieving group colors." });
        }
    });

    app.post("/user-orgs", validateSession, async (req, res) => {
        try {
            // Extract organization _ids from request body
            const orgIds = req.body
                .map((org) => org._id)
                .filter((_id) => _id) // Filter out undefined or invalid ids
                .map((_id) => new ObjectId(_id)); // Convert string _id to ObjectId;

            await mongoClient.connect();
            const database = mongoClient.db(mongoEnv);
            const orgsCollection = database.collection("organizations");

            // Fetch organizations that match the provided _ids
            const organizations = await orgsCollection
                .find({
                    _id: { $in: orgIds },
                })
                .toArray();

            res.json(organizations);
        } catch (error) {
            console.error(error);
            res.status(500).send("Error occurred while fetching data");
        }
    });

    app.get("/user-checklist", validateSession, async (req, res) => {
        const userId = req.uid;
        const userKey = `user:${userId}`;

        try {
            await mongoClient.connect();
            const database = mongoClient.db(mongoEnv);
            const collection = database.collection("objects");

            const user = await collection.findOne({ _key: userKey });

            if (user) {
                res.status(200).json(user.checklistSteps);
            } else {
                res.status(404).json({ message: "User not found" });
            }
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Error retrieving user checklist" });
        }
    });

    app.post("/submit-resource", async (req, res) => {
        const { title, author, year, link, briefExplanation, workGroup, applicableAudience, ageGroup } = req.body;

        // Create a new Date object
        const now = new Date();

        // Adjust for Arizona time (UTC-7)
        now.setHours(now.getHours() - 7);

        // Format the date and time
        const dateTime = now.toLocaleString('en-US', {
            timeZone: 'America/Phoenix',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });

        let info = await req.app.local.transporter.sendMail({
            from: '"[Resource Submission]" <resource-submission@azfarmtoschool.org>',
            to: "support@azfarmtoschool.org",
            cc: "raevynxavier@azfarmtoschool.org",
            subject: "New Resource Submission",
            html: `
      <html lang="en">
        <body>
          <h2>New Resource Submission</h2>
          <table style='border:0; vertical-align:top;'>
            <tr><td><strong>Title: </strong></td><td>${title}</td></tr>
            <tr><td><strong>Author: </strong></td><td>${author}</td></tr>
            <tr><td><strong>Year: </strong></td><td>${year}</td></tr>
            <tr><td><strong>Link: </strong></td><td>${link}</td></tr>
            <tr><td><strong>Brief Explanation: </strong></td><td>${briefExplanation}</td></tr>
            <tr><td><strong>Work Group: </strong></td><td>${workGroup.join(", ")}</td></tr>
            <tr><td><strong>Applicable Audience: </strong></td><td>${applicableAudience.join(", ")}</td></tr>
            <tr><td><strong>Age Group: </strong></td><td>${ageGroup.join(", ")}</td></tr>
            <tr><td><strong>Timestamp: </strong></td><td>${dateTime} Arizona Time</td></tr>
          </table>
        </body>
      </html>
    `,
        });

        res.send(info);
    });

    app.put("/update-checklist-step", validateSession, async (req, res) => {
        const userId = req.uid;
        const userKey = `user:${userId}`;
        const { step } = req.body;

        try {
            await mongoClient.connect();
            const database = mongoClient.db(mongoEnv);
            const collection = database.collection("objects");

            const result = await collection.updateOne(
                { _key: userKey },
                { $set: { [`checklistSteps.${step}`]: true } },
                { upsert: true }
            );

            if (result.upsertedCount > 0 || result.modifiedCount > 0) {
                res.status(200).json({ message: "Checklist step updated successfully" });
            } else {
                res.status(200).json({ message: "Checklist step already updated" });
            }
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "Error updating checklist step" });
        }
    });
}

module.exports = setupLegacyRoutes;