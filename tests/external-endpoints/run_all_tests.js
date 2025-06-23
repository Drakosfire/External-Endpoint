/**
 * Comprehensive Test Runner for External Message System
 * Orchestrates all tests according to the EXTERNAL_MESSAGE_SYSTEM_TESTING_PLAN.md
 */

// Load environment variables from .env file (from project root)
require('dotenv').config({ path: '../../.env' });

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Test configuration
const TEST_CONFIG = {
    timeout: 300000, // 5 minutes per test suite
    retries: 2,
    parallel: false // Run tests sequentially for now
};

// Test suites in order of execution (following the testing plan)
const TEST_SUITES = [
    {
        name: 'Infrastructure & Build',
        phase: 'PHASE 1',
        tests: [
            {
                name: 'MongoDB Metadata',
                file: 'test_mongoose_metadata.js',
                description: 'Database connectivity and metadata handling',
                critical: true
            }
        ]
    },
    {
        name: 'MCP Connectivity & User Isolation',
        phase: 'PHASE 2',
        tests: [
            {
                name: 'MCP Connectivity',
                file: 'test_mcp_connectivity.js',
                description: 'MCP server connections and user isolation',
                critical: true
            },
            {
                name: 'MCP User Isolation',
                file: 'test_mcp_user_isolation.js',
                description: 'Comprehensive MCP user isolation with MongoDB storage',
                critical: true
            }
        ]
    },
    {
        name: 'External Endpoint Testing',
        phase: 'PHASE 3',
        tests: [
            {
                name: 'User Creation & JWT Auth',
                file: 'test_user_creation.js',
                description: 'User creation and JWT authentication',
                critical: true
            },
            {
                name: 'Phone Validation',
                file: 'test_phone_validation.js',
                description: 'Phone number validation and normalization',
                critical: true
            },
            {
                name: 'SMS Enhanced Processing',
                file: 'test_sms_enhanced.js',
                description: 'Enhanced SMS message processing',
                critical: true
            }
        ]
    },
    {
        name: 'Route Integration Testing',
        phase: 'PHASE 4',
        tests: [
            {
                name: 'JWT Authentication',
                file: 'test_jwt_authentication.js',
                description: 'JWT token validation and API security',
                critical: true
            }
        ]
    },
    {
        name: 'Frontend Integration Testing',
        phase: 'PHASE 5',
        tests: [
            {
                name: 'SSE Real-time',
                file: 'test_sse_realtime.js',
                description: 'Server-Sent Events and real-time updates',
                critical: false // Optional since UI testing is manual
            }
        ]
    },
    {
        name: 'End-to-End Integration',
        phase: 'PHASE 6',
        tests: [
            {
                name: 'End-to-End Flow',
                file: 'test_end_to_end.js',
                description: 'Complete SMS to LibreChat to AI flow',
                critical: true
            }
        ]
    }
];

/**
 * Validate critical environment variables for testing
 */
function validateCriticalEnvironmentVariables() {
    console.log('🔍 Validating environment variables from .env file...\n');

    const criticalVars = [
        { name: 'MONGO_URI', value: process.env.MONGO_URI, description: 'MongoDB connection string' },
        { name: 'JWT_SECRET', value: process.env.JWT_SECRET, description: 'JWT authentication secret' },
        { name: 'EXTERNAL_MESSAGE_API_KEY', value: process.env.EXTERNAL_MESSAGE_API_KEY, description: 'External message API key' }
    ];

    const missingVars = criticalVars.filter(envVar => !envVar.value);

    if (missingVars.length > 0) {
        console.error('❌ Missing critical environment variables in .env file:');
        missingVars.forEach(envVar => {
            console.error(`   - ${envVar.name}: ${envVar.description}`);
        });
        console.error('\n📝 Please create/update your .env file with the following variables:');
        console.error('   MONGO_URI=mongodb://localhost:27017/LibreChat');
        console.error('   JWT_SECRET=your_jwt_secret_here');
        console.error('   EXTERNAL_MESSAGE_API_KEY=your_api_key_here');
        console.error('   TEST_BASE_URL=http://localhost:3080  # Optional');
        console.error('\n📖 See TESTING_ENVIRONMENT_SETUP.md for detailed setup instructions');
        return false;
    }

    console.log('✅ All critical environment variables are set:');
    criticalVars.forEach(envVar => {
        const displayValue = envVar.name.includes('SECRET') || envVar.name.includes('KEY')
            ? `${envVar.value.substring(0, 8)}...`
            : envVar.value;
        console.log(`   ✅ ${envVar.name}: ${displayValue}`);
    });

    console.log('');
    return true;
}

/**
 * Check if a test file exists
 */
function testFileExists(filename) {
    return fs.existsSync(path.join(__dirname, filename));
}

/**
 * Run a single test file
 */
function runTestFile(testFile, timeout = TEST_CONFIG.timeout) {
    return new Promise((resolve) => {
        console.log(`\n🔄 Running: ${testFile}`);
        console.log('─'.repeat(50));

        const testProcess = spawn('node', [testFile], {
            stdio: 'inherit',
            cwd: __dirname
        });

        let timeoutHandle;
        let resolved = false;

        const finish = (result) => {
            if (!resolved) {
                resolved = true;
                if (timeoutHandle) {
                    clearTimeout(timeoutHandle);
                }
                resolve(result);
            }
        };

        // Set timeout
        timeoutHandle = setTimeout(() => {
            console.log(`\n⚠️ Test timeout: ${testFile}`);
            testProcess.kill('SIGTERM');
            finish({ success: false, error: 'Timeout', code: 'TIMEOUT' });
        }, timeout);

        testProcess.on('close', (code) => {
            const success = code === 0;
            console.log(`\n${success ? '✅' : '❌'} Test ${success ? 'PASSED' : 'FAILED'}: ${testFile} (exit code: ${code})`);
            finish({ success, code, error: success ? null : `Exit code: ${code}` });
        });

        testProcess.on('error', (error) => {
            console.log(`\n❌ Test ERROR: ${testFile} - ${error.message}`);
            finish({ success: false, error: error.message, code: 'ERROR' });
        });
    });
}

/**
 * Run a test suite with retries
 */
async function runTestSuite(suite) {
    console.log(`\n🚀 ${suite.phase}: ${suite.name}`);
    console.log('='.repeat(70));

    const results = [];

    for (const test of suite.tests) {
        if (!testFileExists(test.file)) {
            console.log(`\n⚠️ Test file not found: ${test.file}`);
            results.push({
                name: test.name,
                file: test.file,
                success: false,
                error: 'File not found',
                critical: test.critical,
                skipped: true
            });
            continue;
        }

        console.log(`\n📋 ${test.name}`);
        console.log(`📄 File: ${test.file}`);
        console.log(`📝 Description: ${test.description}`);
        console.log(`🔥 Critical: ${test.critical ? 'Yes' : 'No'}`);

        let testResult = null;
        let attempts = 0;
        const maxAttempts = test.critical ? TEST_CONFIG.retries + 1 : 1;

        while (attempts < maxAttempts && (!testResult || !testResult.success)) {
            attempts++;
            if (attempts > 1) {
                console.log(`\n🔄 Retry attempt ${attempts - 1}/${TEST_CONFIG.retries} for ${test.name}`);
            }

            testResult = await runTestFile(test.file);

            if (!testResult.success && attempts < maxAttempts) {
                console.log(`\n⏳ Waiting 5 seconds before retry...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        results.push({
            name: test.name,
            file: test.file,
            success: testResult.success,
            error: testResult.error,
            code: testResult.code,
            critical: test.critical,
            attempts: attempts,
            skipped: false
        });

        if (!testResult.success && test.critical) {
            console.log(`\n🛑 Critical test failed: ${test.name}`);
            console.log(`   This may indicate a serious issue that should be addressed.`);
        }
    }

    return results;
}

/**
 * Generate test report
 */
function generateTestReport(allResults) {
    console.log('\n' + '='.repeat(70));
    console.log('📊 EXTERNAL MESSAGE SYSTEM TEST REPORT');
    console.log('='.repeat(70));

    let totalTests = 0;
    let passedTests = 0;
    let criticalTests = 0;
    let criticalPassed = 0;
    let skippedTests = 0;

    for (const [phaseName, phaseResults] of allResults) {
        console.log(`\n🎯 ${phaseName}:`);

        for (const result of phaseResults) {
            totalTests++;
            if (result.critical) criticalTests++;
            if (result.skipped) {
                skippedTests++;
                console.log(`   ⚠️ ${result.name}: SKIPPED (${result.error})`);
            } else if (result.success) {
                passedTests++;
                if (result.critical) criticalPassed++;
                console.log(`   ✅ ${result.name}: PASSED`);
            } else {
                console.log(`   ❌ ${result.name}: FAILED (${result.error})`);
                if (result.attempts > 1) {
                    console.log(`      Attempts: ${result.attempts}`);
                }
            }
        }
    }

    console.log('\n' + '─'.repeat(70));
    console.log('📈 SUMMARY:');
    console.log(`   Total Tests: ${totalTests}`);
    console.log(`   Passed: ${passedTests}`);
    console.log(`   Failed: ${totalTests - passedTests - skippedTests}`);
    console.log(`   Skipped: ${skippedTests}`);
    console.log(`   Success Rate: ${Math.round((passedTests / (totalTests - skippedTests)) * 100)}%`);

    console.log('\n🔥 CRITICAL TESTS:');
    console.log(`   Critical Tests: ${criticalTests}`);
    console.log(`   Critical Passed: ${criticalPassed}`);
    console.log(`   Critical Success Rate: ${Math.round((criticalPassed / criticalTests) * 100)}%`);

    // Overall assessment
    console.log('\n🎯 ASSESSMENT:');
    if (criticalPassed === criticalTests) {
        console.log('   ✅ ALL CRITICAL TESTS PASSED');
        console.log('   🎉 External message system is ready for production!');
    } else {
        console.log('   ❌ SOME CRITICAL TESTS FAILED');
        console.log('   🔧 External message system needs attention before production.');
    }

    if (passedTests === totalTests - skippedTests) {
        console.log('   🏆 PERFECT SCORE: All available tests passed!');
    } else if ((passedTests / (totalTests - skippedTests)) >= 0.8) {
        console.log('   👍 GOOD: Most tests passed (≥80%)');
    } else {
        console.log('   ⚠️ POOR: Many tests failed (<80%)');
    }

    return {
        total: totalTests,
        passed: passedTests,
        failed: totalTests - passedTests - skippedTests,
        skipped: skippedTests,
        critical: criticalTests,
        criticalPassed: criticalPassed,
        successRate: Math.round((passedTests / (totalTests - skippedTests)) * 100),
        criticalSuccessRate: Math.round((criticalPassed / criticalTests) * 100),
        ready: criticalPassed === criticalTests
    };
}

/**
 * Check prerequisites
 */
function checkPrerequisites() {
    console.log('🔍 Checking prerequisites...');

    const checks = [
        {
            name: 'Node.js version',
            check: () => {
                const version = process.version;
                const majorVersion = parseInt(version.slice(1).split('.')[0]);
                return majorVersion >= 16;
            },
            value: () => process.version,
            required: 'Node.js 16+'
        },

        {
            name: 'LibreChat configuration',
            check: () => fs.existsSync('./librechat.yaml'),
            value: () => fs.existsSync('./librechat.yaml') ? 'Found' : 'Missing',
            required: 'librechat.yaml configuration file'
        }
    ];

    let allPassed = true;

    for (const check of checks) {
        const passed = check.check();
        const status = passed ? '✅' : '❌';
        console.log(`   ${status} ${check.name}: ${check.value()} ${!passed ? `(Required: ${check.required})` : ''}`);
        if (!passed) allPassed = false;
    }

    return allPassed;
}

/**
 * Main test runner function
 */
async function runAllTests() {
    console.log('🚀 EXTERNAL MESSAGE SYSTEM COMPREHENSIVE TEST SUITE');
    console.log('📋 Following EXTERNAL_MESSAGE_SYSTEM_TESTING_PLAN.md');
    console.log('='.repeat(70));

    // Validate environment variables first
    const envValid = validateCriticalEnvironmentVariables();
    if (!envValid) {
        console.error('💥 Cannot proceed with testing due to missing environment variables.');
        console.error('Please configure your .env file and try again.\n');
        process.exit(1);
    }

    // Check other prerequisites
    if (!checkPrerequisites()) {
        console.log('\n❌ Prerequisites not met. Please check the requirements above.');
        process.exit(1);
    }

    console.log('\n✅ Prerequisites met. Starting test execution...');

    const startTime = Date.now();
    const allResults = [];

    try {
        // Run each test phase
        for (const suite of TEST_SUITES) {
            const results = await runTestSuite(suite);
            allResults.push([`${suite.phase}: ${suite.name}`, results]);

            // Check if critical tests failed
            const criticalFailures = results.filter(r => r.critical && !r.success && !r.skipped);
            if (criticalFailures.length > 0) {
                console.log(`\n⚠️ Critical failures in ${suite.name}:`);
                criticalFailures.forEach(failure => {
                    console.log(`   - ${failure.name}: ${failure.error}`);
                });

                // Ask if we should continue (in non-CI environments)
                if (!process.env.CI) {
                    console.log('\n❓ Continue with remaining tests despite critical failures? (Critical issues detected)');
                }
            }
        }

        // Generate final report
        const report = generateTestReport(allResults);

        const endTime = Date.now();
        const duration = Math.round((endTime - startTime) / 1000);

        console.log(`\n⏱️ Total execution time: ${duration} seconds`);
        console.log(`📅 Completed at: ${new Date().toISOString()}`);

        // Exit with appropriate code
        if (report.ready) {
            console.log('\n🎉 Test suite completed successfully!');
            process.exit(0);
        } else {
            console.log('\n⚠️ Test suite completed with critical issues.');
            process.exit(1);
        }

    } catch (error) {
        console.error('\n💥 Test suite crashed:', error);
        process.exit(2);
    }
}

// Export for programmatic use
module.exports = {
    runAllTests,
    runTestSuite,
    runTestFile,
    generateTestReport,
    TEST_SUITES
};

// Run if called directly
if (require.main === module) {
    runAllTests().catch(error => {
        console.error('💥 Test runner failed:', error);
        process.exit(2);
    });
} 