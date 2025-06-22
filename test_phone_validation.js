/**
 * Simplified SMS Phone Number Validation Test
 * Tests the core phone number normalization logic without LibreChat dependencies
 */

/**
 * Enhanced phone number normalization (same as in validateExternalMessage.js)
 */
const normalizePhoneNumber = (phoneNumber) => {
    if (!phoneNumber || typeof phoneNumber !== 'string') {
        return null;
    }

    // Remove all non-digit and non-plus characters
    let normalized = phoneNumber.replace(/[^0-9+]/g, '');

    // Handle common formats
    if (normalized.startsWith('1') && normalized.length === 11 && !normalized.startsWith('+')) {
        // US number without country code prefix
        normalized = '+' + normalized;
    } else if (normalized.length === 10 && !normalized.startsWith('+')) {
        // US number without country code
        normalized = '+1' + normalized;
    } else if (!normalized.startsWith('+') && normalized.length > 7) {
        // International number without + prefix
        normalized = '+' + normalized;
    }

    // Validate E.164 format (+ followed by 7-15 digits)
    const e164Regex = /^\+[1-9]\d{6,14}$/;
    if (!e164Regex.test(normalized)) {
        console.warn('Invalid phone number format:', phoneNumber, '->', normalized);
        return null;
    }

    return normalized;
};

/**
 * Extract phone number from various request locations
 */
const extractPhoneNumber = (requestBody) => {
    const possibleSources = [
        requestBody.metadata?.phoneNumber,
        requestBody.from,
        requestBody.metadata?.from,
        requestBody.phoneNumber
    ];

    for (const source of possibleSources) {
        if (source) {
            const normalized = normalizePhoneNumber(source);
            if (normalized) {
                return normalized;
            }
        }
    }

    return null;
};

// Test configurations
const testPhoneNumbers = [
    // Valid formats
    { input: '+1234567890', expected: '+1234567890' },
    { input: '+44123456789', expected: '+44123456789' },
    { input: '+33123456789', expected: '+33123456789' },
    { input: '+1 (555) 123-4567', expected: '+15551234567' },
    { input: '555-123-4567', expected: '+15551234567' },
    { input: '15551234567', expected: '+15551234567' },
    { input: '1234567890', expected: '+11234567890' },
    { input: '5551234567', expected: '+15551234567' },

    // Edge cases
    { input: '+12345678901234', expected: '+12345678901234' }, // Long international
    { input: '+49301234567', expected: '+49301234567' },    // German format

    // Invalid formats (should be rejected)
    { input: '123', expected: null },             // Too short
    { input: 'abc123', expected: null },          // Contains letters
    { input: '+', expected: null },               // Just plus
    { input: '', expected: null },                // Empty
    { input: null, expected: null },              // Null
    { input: undefined, expected: null },         // Undefined
    { input: '+0123456789', expected: null },     // Starts with 0 after +
];

/**
 * Test phone number normalization and validation
 */
function testPhoneNumberValidation() {
    console.log('📱 Testing Phone Number Validation & Normalization\n');

    let passed = 0;
    let failed = 0;

    for (const testCase of testPhoneNumbers) {
        const result = normalizePhoneNumber(testCase.input);
        const inputDisplay = testCase.input === null ? 'null' :
            testCase.input === undefined ? 'undefined' :
                `"${testCase.input}"`;

        if (result === testCase.expected) {
            console.log(`✅ ${inputDisplay} -> ${result || 'null'}`);
            passed++;
        } else {
            console.log(`❌ ${inputDisplay} -> ${result || 'null'} (expected: ${testCase.expected || 'null'})`);
            failed++;
        }
    }

    console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
    return { passed, failed };
}

/**
 * Test phone number extraction from request bodies
 */
function testPhoneNumberExtraction() {
    console.log('\n📞 Testing Phone Number Extraction from Request Bodies\n');

    const testRequests = [
        {
            name: 'metadata.phoneNumber',
            body: { metadata: { phoneNumber: '+1234567890' } },
            expected: '+1234567890'
        },
        {
            name: 'from field',
            body: { from: '555-123-4567' },
            expected: '+15551234567'
        },
        {
            name: 'metadata.from',
            body: { metadata: { from: '+44123456789' } },
            expected: '+44123456789'
        },
        {
            name: 'direct phoneNumber',
            body: { phoneNumber: '1234567890' },
            expected: '+11234567890'
        },
        {
            name: 'multiple sources (metadata priority)',
            body: {
                phoneNumber: '1111111111',
                from: '2222222222',
                metadata: { phoneNumber: '+3333333333' }
            },
            expected: '+3333333333'
        },
        {
            name: 'no phone number',
            body: { content: 'Hello world' },
            expected: null
        },
        {
            name: 'invalid phone number',
            body: { from: 'abc123' },
            expected: null
        }
    ];

    let passed = 0;
    let failed = 0;

    for (const testCase of testRequests) {
        const result = extractPhoneNumber(testCase.body);

        if (result === testCase.expected) {
            console.log(`✅ ${testCase.name}: ${result || 'null'}`);
            passed++;
        } else {
            console.log(`❌ ${testCase.name}: ${result || 'null'} (expected: ${testCase.expected || 'null'})`);
            failed++;
        }
    }

    console.log(`\n📊 Extraction Results: ${passed} passed, ${failed} failed`);
    return { passed, failed };
}

/**
 * Test username generation logic
 */
function testUsernameGeneration() {
    console.log('\n👤 Testing Username Generation Logic\n');

    const testPhones = [
        '+1234567890',
        '+44123456789',
        '+1 (555) 123-4567',
        '555-123-4567'
    ];

    console.log('📝 Username generation patterns:');
    for (const phone of testPhones) {
        const normalized = normalizePhoneNumber(phone);
        if (normalized) {
            const baseUsername = `sms_${normalized.replace(/[^0-9]/g, '')}`;
            console.log(`   ${phone} -> ${normalized} -> ${baseUsername}`);
        } else {
            console.log(`   ${phone} -> INVALID`);
        }
    }

    // Test conflict resolution
    console.log('\n🔄 Username conflict resolution simulation:');
    const conflictPhone = '+1234567890';
    const baseUsername = `sms_${conflictPhone.replace(/[^0-9]/g, '')}`;

    console.log(`   Base: ${baseUsername}`);
    console.log(`   Conflict 1: ${baseUsername}_1`);
    console.log(`   Conflict 2: ${baseUsername}_2`);
    console.log(`   Fallback: ${baseUsername}_${Date.now()}`);
}

/**
 * Test edge cases
 */
function testEdgeCases() {
    console.log('\n⚠️  Testing Edge Cases\n');

    // Test international numbers
    const internationalNumbers = [
        '+44123456789',    // UK
        '+33123456789',    // France  
        '+49301234567',    // Germany
        '+81312345678',    // Japan
        '+61234567890',    // Australia
        '+5511987654321',  // Brazil
    ];

    console.log('🌍 International number validation:');
    for (const phone of internationalNumbers) {
        const result = normalizePhoneNumber(phone);
        console.log(`   ${phone} -> ${result || 'INVALID'}`);
    }

    // Test boundary cases
    console.log('\n📏 Boundary cases:');
    const boundaryCases = [
        '+1234567',      // 7 digits (minimum)
        '+123456789012345', // 15 digits (maximum)
        '+12345678901234567', // 17 digits (too long)
        '+123456',       // 6 digits (too short)
    ];

    for (const phone of boundaryCases) {
        const result = normalizePhoneNumber(phone);
        console.log(`   ${phone} -> ${result || 'INVALID'}`);
    }
}

/**
 * Main test runner
 */
function runAllTests() {
    console.log('🚀 SMS Phone Number Validation Test Suite\n');
    console.log('='.repeat(60) + '\n');

    const results = {
        validation: testPhoneNumberValidation(),
        extraction: testPhoneNumberExtraction()
    };

    testUsernameGeneration();
    testEdgeCases();

    console.log('\n' + '='.repeat(60));
    console.log('✅ Test Suite Complete!');
    console.log(`\n📊 Overall Results:`);
    console.log(`   Validation: ${results.validation.passed}/${results.validation.passed + results.validation.failed}`);
    console.log(`   Extraction: ${results.extraction.passed}/${results.extraction.passed + results.extraction.failed}`);

    const totalPassed = results.validation.passed + results.extraction.passed;
    const totalTests = results.validation.passed + results.validation.failed +
        results.extraction.passed + results.extraction.failed;

    console.log(`   Total: ${totalPassed}/${totalTests} (${Math.round(totalPassed / totalTests * 100)}%)`);

    if (totalPassed === totalTests) {
        console.log('\n🎉 All tests passed! Phone number validation is working correctly.');
        console.log('\n📋 Ready for manual SMS testing with your phone number.');
    } else {
        console.log('\n⚠️  Some tests failed. Review the validation logic before proceeding.');
    }
}

// Export for use in other scripts
module.exports = {
    normalizePhoneNumber,
    extractPhoneNumber,
    testPhoneNumberValidation,
    testPhoneNumberExtraction,
    testUsernameGeneration,
    testEdgeCases,
    runAllTests
};

// Run all tests if called directly
if (require.main === module) {
    runAllTests();
} 