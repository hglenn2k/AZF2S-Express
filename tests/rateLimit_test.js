// tests/rateLimit_test.js
const assert = require('assert');
const { test} = require('./testRunner.js');require('path');
// Load the rate limiter module
const configureLimiters = require('../middleware/rateLimits');

/**
 * Validate rate limit configuration
 * @returns {boolean} True if validation passes
 */
function validateRateLimit() {
    let allTestsPassed = true;

    // Test 1: Module exports a function
    allTestsPassed = test('Should export a function', () => {
        assert.strictEqual(typeof configureLimiters, 'function',
            'configureLimiters should be a function');
    }) && allTestsPassed;

    // Test 2: Returns all required limiters
    allTestsPassed = test('Should return all required limiters', () => {
        const limiters = configureLimiters();
        const requiredLimiters = [
            'accountCheckLimiter',
            'signupLimiter',
            'loginLimiter',
            'apiLimiter'
        ];

        for (const limiterName of requiredLimiters) {
            assert.ok(limiters[limiterName],
                `Missing required limiter: ${limiterName}`);

            // Basic check that it's a function or object (middleware)
            const limiter = limiters[limiterName];
            assert.ok(
                typeof limiter === 'function' || typeof limiter === 'object',
                `${limiterName} is not a valid middleware`
            );
        }
    }) && allTestsPassed;

    // Test 3: Different settings for production/development
    allTestsPassed = test('Should use stricter limits in production', () => {
        const devLimiters = configureLimiters({ isProduction: false });
        const prodLimiters = configureLimiters({ isProduction: true });

        // Login limits test
        assert.ok(
            devLimiters.loginLimiter.max > prodLimiters.loginLimiter.max,
            `Production login limit (${prodLimiters.loginLimiter.max}) should be ` +
            `stricter than development (${devLimiters.loginLimiter.max})`
        );
    }) && allTestsPassed;

    // Test 4: Custom options applied correctly
    allTestsPassed = test('Should apply custom options', () => {
        // Custom message for testing
        const customMessage = { error: 'Custom error message' };

        const limiters = configureLimiters({
            message: customMessage
        });

        // Check that message is applied
        assert.deepStrictEqual(
            limiters.accountCheckLimiter.message,
            customMessage,
            'Custom error message was not applied'
        );
    }) && allTestsPassed;

    return allTestsPassed;
}

// Run validation immediately when this file is loaded
console.log('Running rate limit validation tests...');
if (!validateRateLimit()) {
    console.error('❌ FATAL ERROR: Rate limit configuration is invalid!');
    process.exit(1);
} else {
    console.log('✅ Rate limit configuration validated successfully');
}

module.exports = {};