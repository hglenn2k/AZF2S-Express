/**
 * Validates fields for the is-account-available endpoint
 * @param {Object} body - Request body
 * @returns {Object} - { isValid, errors }
 */
const validateAccountAvailability = (body) => {
    const errors = {};

    if (!body.username || typeof body.username !== 'string' || body.username.trim() === '') {
        errors.username = 'Username is required';
    }

    validateEmailField(body, errors);

    return getValidationResult(errors);
};

/**
 * Validates fields for the sign-up endpoint
 * @param {Object} body - Request body
 * @returns {Object} - { isValid, errors }
 */
const validateSignUp = (body) => {
    const errors = {};

    if (!body.username || typeof body.username !== 'string' || body.username.trim() === '') {
        errors.username = 'Username is required';
    }

    validateEmailField(body, errors);

    if (!body.password || typeof body.password !== 'string') {
        errors.password = 'Password is required';
    } else if (body.password.length < 8) {
        errors.password = 'Password must be at least 8 characters';
    }

    return getValidationResult(errors);
};

/**
 * Validates fields for the new-user endpoint
 * @param {Object} body - Request body
 * @returns {Object} - { isValid, errors }
 */
const validateNewUser = (body) => {
    const errors = {};

    if (!body.uid) {
        errors.uid = 'User ID is required';
    }

    if (!body.fullname || typeof body.fullname !== 'string' || body.fullname.trim() === '') {
        errors.fullname = 'Full name is required';
    }

    validateEmailField(body, errors);

    return getValidationResult(errors);
};

/**
 * Validates fields for the new-user-email endpoint
 * @param {Object} body - Request body
 * @returns {Object} - { isValid, errors }
 */
const validateNewUserEmail = (body) => {
    const errors = {};

    if (!body.fullName || typeof body.fullName !== 'string' || body.fullName.trim() === '') {
        errors.fullName = 'Full name is required';
    }

    if (!body.username || typeof body.username !== 'string' || body.username.trim() === '') {
        errors.username = 'Username is required';
    }

    validateEmailField(body, errors);

    return getValidationResult(errors);
};

/**
 * Validates fields for the login endpoint
 * @param {Object} body - Request body
 * @returns {Object} - { isValid, errors }
 */
const validateLogin = (body) => {
    const errors = {};

    if (!body.username || typeof body.username !== 'string' || body.username.trim() === '') {
        errors.username = 'Username is required';
    }

    if (!body.password || typeof body.password !== 'string') {
        errors.password = 'Password is required';
    }

    return getValidationResult(errors);
};

/**
 * Helper function to validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} - Whether the email is valid
 */
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

/**
 * Helper function to validate email field and add errors if needed
 * @param {Object} body - Request body
 * @param {Object} errors - Errors object to add to
 */
const validateEmailField = (body, errors) => {
    if (!body.email || typeof body.email !== 'string' || body.email.trim() === '') {
        errors.email = 'Email is required';
    } else if (!isValidEmail(body.email)) {
        errors.email = 'Email format is invalid';
    }
};

/**
 * Helper function to get the validation result
 * @param {Object} errors - Errors object
 * @returns {Object} - { isValid, errors }
 */
const getValidationResult = (errors) => {
    return {
        isValid: Object.keys(errors).length === 0,
        errors
    };
};

module.exports = {
    validateAccountAvailability,
    validateSignUp,
    validateNewUser,
    validateNewUserEmail,
    validateLogin
};