// tests/sanitizeRequests_test.js
const assert = require('assert');
const { test, runTests } = require('./testRunner.js');
const sanitizeRequests = require('../middleware/sanitizeRequests');

/**
 * Validate sanitization module
 * @returns {Promise<boolean>} True if validation passes
 */
async function validateSanitizeRequests() {
    const tests = [
        // Test 1: Module exports all required functions
        () => test('Should export all required functions', () => {
            const requiredFunctions = [
                'sanitizeUserInput',
                'sanitizeObject',
                'sanitizeRequestBody'
            ];

            for (const funcName of requiredFunctions) {
                assert.strictEqual(
                    typeof sanitizeRequests[funcName],
                    'function',
                    `Missing or invalid function: ${funcName}`
                );
            }
        }),

        // Test 2: sanitizeUserInput should strip HTML tags AND dangerous content
        () => test('sanitizeUserInput should strip HTML tags and script content', () => {
            const input = '<script>alert("XSS")</script><b>Hello</b>';
            const expected = 'Hello';  // Script content should be removed for security
            const result = sanitizeRequests.sanitizeUserInput(input);
            assert.strictEqual(result, expected, 'Should strip all HTML tags and script content');
        }),

        // Test 3: sanitizeUserInput should handle non-string inputs
        () => test('sanitizeUserInput should handle non-string inputs', () => {
            const inputs = [null, undefined, 123, {}, []];

            for (const input of inputs) {
                const result = sanitizeRequests.sanitizeUserInput(input);
                assert.strictEqual(result, '', `Should return empty string for ${typeof input}`);
            }
        }),

        // Test 4: sanitizeObject should sanitize all string properties
        () => test('sanitizeObject should sanitize all string properties', () => {
            const input = {
                name: '<b>John</b>',
                age: 30,
                nested: {
                    bio: '<script>alert("nested")</script>bio'
                },
                items: ['<i>Item 1</i>', '<u>Item 2</u>']
            };

            const expected = {
                name: 'John',
                age: 30,
                nested: {
                    bio: 'bio'  // Script content removed for security
                },
                items: ['Item 1', 'Item 2']
            };

            const result = sanitizeRequests.sanitizeObject(input);
            assert.deepStrictEqual(result, expected, 'Should sanitize all string properties recursively');
        }),

        // Test 5: sanitizeObject should handle non-object inputs
        () => test('sanitizeObject should handle non-object inputs', () => {
            const inputs = [null, undefined, 123, 'string'];

            for (const input of inputs) {
                const result = sanitizeRequests.sanitizeObject(input);
                assert.strictEqual(result, input, `Should return input as is for ${typeof input}`);
            }
        }),

        // Test 6: sanitizeRequestBody middleware should sanitize req.body
        () => test('sanitizeRequestBody middleware should sanitize req.body', () => {
            // Mock Express request, response, and next function
            const req = {
                body: {
                    username: '<script>alert("XSS")</script>user',
                    email: 'test@<b>example</b>.com'
                }
            };

            const res = {};

            let nextCalled = false;
            const next = () => {
                nextCalled = true;
            };

            // Expected sanitized body - script content removed for security
            const expected = {
                username: 'user',
                email: 'test@example.com'
            };

            // Call middleware
            sanitizeRequests.sanitizeRequestBody(req, res, next);

            // Assert body was sanitized
            assert.deepStrictEqual(req.body, expected, 'Should sanitize request body');

            // Assert next was called
            assert.strictEqual(nextCalled, true, 'Should call next function');
        })
    ];

    return await runTests(tests);
}

// Run validation immediately when this file is loaded
console.log('Running sanitization module validation tests...');
validateSanitizeRequests().then(allPassed => {
    if (!allPassed) {
        console.error('❌ FATAL ERROR: Sanitization module validation failed!');
        process.exit(1);
    } else {
        console.log('✅ Sanitization module validated successfully');
    }
}).catch(error => {
    console.error('❌ FATAL ERROR: Unexpected error during validation:', error);
    process.exit(1);
});

module.exports = {};