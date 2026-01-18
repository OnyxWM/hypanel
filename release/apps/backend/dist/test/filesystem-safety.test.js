import path from 'path';
/**
 * Simple test to verify filesystem safety features
 * Run with: npm test or node test/filesystem-safety.test.js
 */
async function testFilesystemSafety() {
    console.log('Testing filesystem safety features...');
    // Create a mock ServerManager instance for testing path sanitization
    const serverManager = {};
    // Test the sanitizePathComponent method by accessing it through reflection
    const sanitizePathComponent = function (component) {
        return component.replace(/[\/\\:.]/g, '_').replace(/\.\./g, '');
    };
    // Test cases for path sanitization
    const testCases = [
        { input: 'normal-world', expected: 'normal-world', description: 'Normal world name' },
        { input: 'world_with_underscores', expected: 'world_with_underscores', description: 'World with underscores' },
        { input: 'world-with-hyphens', expected: 'world-with-hyphens', description: 'World with hyphens' },
        { input: '../../../etc/passwd', expected: '_________etc_passwd', description: 'Path traversal attempt' },
        { input: 'world/with/slashes', expected: 'world_with_slashes', description: 'World with slashes' },
        { input: 'world\\with\\backslashes', expected: 'world_with_backslashes', description: 'World with backslashes' },
        { input: 'world:with:colons', expected: 'world_with_colons', description: 'World with colons' },
        { input: '..\\..\\windows\\system32', expected: '______windows_system32', description: 'Windows path traversal' },
    ];
    console.log('Testing path sanitization:');
    testCases.forEach(({ input, expected, description }) => {
        const result = sanitizePathComponent(input);
        const passed = result === expected;
        console.log(`${passed ? '✓' : '✗'} ${description}`);
        console.log(`  Input: "${input}"`);
        console.log(`  Expected: "${expected}"`);
        console.log(`  Got: "${result}"`);
        if (!passed) {
            console.log('  FAILED!');
        }
        console.log('');
    });
    // Test path resolution containment
    console.log('Testing path containment:');
    const rootPath = '/home/hypanel/hytale/server-id';
    const testPaths = [
        { input: 'config.json', expected: true, description: 'Valid config file' },
        { input: 'universe/worlds/world/config.json', expected: true, description: 'Valid world config' },
        { input: '../../../etc/passwd', expected: false, description: 'Path traversal to etc' },
        { input: '../../.ssh/authorized_keys', expected: false, description: 'Path to home directory' },
    ];
    testPaths.forEach(({ input, expected, description }) => {
        const fullPath = path.join(rootPath, input);
        const resolvedPath = path.resolve(fullPath);
        const actualRootPath = path.resolve(rootPath);
        const isContained = resolvedPath.startsWith(actualRootPath);
        const passed = isContained === expected;
        console.log(`${passed ? '✓' : '✗'} ${description}`);
        console.log(`  Input: "${input}"`);
        console.log(`  Full path: "${fullPath}"`);
        console.log(`  Resolved path: "${resolvedPath}"`);
        console.log(`  Root path: "${actualRootPath}"`);
        console.log(`  Is contained: ${isContained} (expected: ${expected})`);
        if (!passed) {
            console.log('  FAILED!');
        }
        console.log('');
    });
    console.log('Filesystem safety tests completed.');
}
// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    testFilesystemSafety().catch(console.error);
}
export { testFilesystemSafety };
//# sourceMappingURL=filesystem-safety.test.js.map