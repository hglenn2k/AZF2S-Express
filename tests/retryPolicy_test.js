// tests/retryPolicy_test.js
const assert = require('assert');
const { test, runTests } = require('./testRunner.js');require('path');
const retryPolicy = require('../middleware/retryPolicy');

/**
 * Validate retry policy module
 * @returns {Promise<boolean>} True if validation passes
 */
async function validateRetryPolicy() {
    const tests = [
        // Test 1: Module exports all required functions
        () => test('Should export all required functions', () => {
            const requiredFunctions = [
                'retryOperation',
                'withDatabaseRetry',
                'withNetworkRetry'
            ];

            for (const funcName of requiredFunctions) {
                assert.strictEqual(
                    typeof retryPolicy[funcName],
                    'function',
                    `Missing or invalid function: ${funcName}`
                );
            }
        }),

        // Test 2: retryOperation should work for successful operations
        () => test('retryOperation should work for successful operations', async () => {
            let callCount = 0;
            const successOp = async () => {
                callCount++;
                return 'success';
            };

            const result = await retryPolicy.retryOperation(successOp, { maxRetries: 3 });
            assert.strictEqual(result, 'success', 'Should return operation result');
            assert.strictEqual(callCount, 1, 'Should only call once if successful');
        }),

        // Test 3: retryOperation should retry on failures
        () => test('retryOperation should retry on failures', async () => {
            let callCount = 0;
            const failingOp = async () => {
                callCount++;
                if (callCount < 3) {
                    throw new Error('Temporary failure');
                }
                return 'success after retries';
            };

            try {
                const result = await retryPolicy.retryOperation(failingOp, {
                    maxRetries: 3,
                    initialDelay: 10, // Small delay for test
                    factor: 1 // No exponential for test speed
                });

                assert.strictEqual(result, 'success after retries',
                    'Should return operation result after retries');
                assert.strictEqual(callCount, 3,
                    'Should retry until success');

            } catch (error) {
                assert.fail(`Should not throw error: ${error.message}`);
            }
        }),

        // Test 4: retryOperation should respect maxRetries
        () => test('retryOperation should respect maxRetries', async () => {
            let callCount = 0;
            const alwaysFailingOp = async () => {
                callCount++;
                throw new Error('Always fails');
            };

            try {
                await retryPolicy.retryOperation(alwaysFailingOp, {
                    maxRetries: 3,
                    initialDelay: 10,
                    factor: 1
                });

                assert.fail('Should have thrown error after max retries');
            } catch (error) {
                assert.strictEqual(callCount, 3, 'Should retry exactly maxRetries times');
                assert.strictEqual(error.message, 'Always fails', 'Should throw original error');
            }
        }),

        // Test 5: withDatabaseRetry should create a function
        () => test('withDatabaseRetry should create a function', () => {
            const dbOp = () => Promise.resolve('db result');
            const wrappedOp = retryPolicy.withDatabaseRetry(dbOp);

            assert.strictEqual(typeof wrappedOp, 'function',
                'withDatabaseRetry should return a function');
        }),

        // Test 6: withNetworkRetry should create a function
        () => test('withNetworkRetry should create a function', () => {
            const networkOp = () => Promise.resolve('network result');
            const wrappedOp = retryPolicy.withNetworkRetry(networkOp);

            assert.strictEqual(typeof wrappedOp, 'function',
                'withNetworkRetry should return a function');
        })
    ];

    return await runTests(tests);
}

// Run validation immediately when this file is loaded
console.log('Running retry policy validation tests...');
validateRetryPolicy().then(allPassed => {
    if (!allPassed) {
        console.error('❌ FATAL ERROR: Retry policy validation failed!');
        process.exit(1);
    } else {
        console.log('✅ Retry policy validated successfully');
    }
}).catch(error => {
    console.error('❌ FATAL ERROR: Unexpected error during validation:', error);
    process.exit(1);
});

module.exports = { validateRetryPolicy };