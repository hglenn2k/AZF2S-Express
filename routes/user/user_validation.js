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

const validateIsAvailable = (body) => {
    const errors = {};

    if (!body.username || typeof body.username !== 'string' || body.username.trim() === '') {
        errors.username = 'Username is required';
    }

    if (!body.email || typeof body.email !== 'string' || body.email.trim() === '') {
        errors.email = 'Email is required';
    }

    return getValidationResult(errors);
}

const getValidationResult = (errors) => {
    return {
        isValid: Object.keys(errors).length === 0,
        errors
    };
};

module.exports = {
    validateLogin,
    validateIsAvailable
};