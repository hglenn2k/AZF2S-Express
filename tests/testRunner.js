/**
 * Simple test runner
 * @param {string} description - Test description
 * @param {Function} testFn - Test function to run
 */
function test(description, testFn) {
    try {
        const result = testFn();
        if (result instanceof Promise) {
            return result
                .then(() => {
                    console.log(`✓ ${description}`);
                    return true;
                })
                .catch(error => {
                    console.error(`✗ ${description}`);
                    console.error(`  ${error.message}`);
                    return false;
                });
        } else {
            console.log(`✓ ${description}`);
            return Promise.resolve(true);
        }
    } catch (error) {
        console.error(`✗ ${description}`);
        console.error(`  ${error.message}`);
        return Promise.resolve(false);
    }
}

/**
 * Run all tests sequentially
 * @param {Array} tests - Array of test functions that return promises
 * @returns {Promise<boolean>} - Whether all tests passed
 */
async function runTests(tests) {
    let allPassed = true;
    for (const testFn of tests) {
        const passed = await testFn();
        allPassed = allPassed && passed;
    }
    return allPassed;
}

// Export the functions so they can be used in other test files
module.exports = {
    test,
    runTests
};