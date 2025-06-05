#!/usr/bin/env node

/**
 * Test script for debug cheat codes
 */

function checkDebugCheats(content) {
  return {
    forceImage: content.includes("''"), // Double single quotes forces image
    instantResponse: content.includes("`")  // Backtick forces instant response
  };
}

function testDebugCheats() {
  console.log('🔧 Testing Debug Cheat Codes...\n');

  const testCases = [
    {
      message: "Hello there",
      expected: { forceImage: false, instantResponse: false },
      description: "Normal message"
    },
    {
      message: "Hello '' world",
      expected: { forceImage: true, instantResponse: false },
      description: "Force image cheat"
    },
    {
      message: "Hello ` world",
      expected: { forceImage: false, instantResponse: true },
      description: "Instant response cheat"
    },
    {
      message: "Hello '' world `",
      expected: { forceImage: true, instantResponse: true },
      description: "Both cheats combined"
    },
    {
      message: "What's going on?",
      expected: { forceImage: false, instantResponse: false },
      description: "Single quote (not cheat)"
    },
    {
      message: "Can you help me ''?",
      expected: { forceImage: true, instantResponse: false },
      description: "Force image at end"
    },
    {
      message: "`Please respond quickly",
      expected: { forceImage: false, instantResponse: true },
      description: "Instant response at start"
    },
    {
      message: "Show me a picture '' and respond fast `!",
      expected: { forceImage: true, instantResponse: true },
      description: "Both cheats in natural sentence"
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    const result = checkDebugCheats(testCase.message);
    const success = result.forceImage === testCase.expected.forceImage && 
                   result.instantResponse === testCase.expected.instantResponse;
    
    if (success) {
      console.log(`✅ ${testCase.description}`);
      console.log(`   Message: "${testCase.message}"`);
      console.log(`   Result: forceImage=${result.forceImage}, instantResponse=${result.instantResponse}`);
      passed++;
    } else {
      console.log(`❌ ${testCase.description}`);
      console.log(`   Message: "${testCase.message}"`);
      console.log(`   Expected: forceImage=${testCase.expected.forceImage}, instantResponse=${testCase.expected.instantResponse}`);
      console.log(`   Got: forceImage=${result.forceImage}, instantResponse=${result.instantResponse}`);
      failed++;
    }
    console.log();
  }

  console.log(`🎯 Test Results: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log('🎉 All debug cheat code tests passed!');
    console.log('\n💡 Usage:');
    console.log("   - Include '' (double single quotes) to force Reddit image");
    console.log("   - Include ` (backtick) to get instant response");
    console.log("   - Both can be combined for instant image responses");
    return true;
  } else {
    console.log('❌ Some tests failed');
    return false;
  }
}

// Run the test
if (require.main === module) {
  testDebugCheats()
    .then ? testDebugCheats().then(success => process.exit(success ? 0 : 1))
    : process.exit(testDebugCheats() ? 0 : 1);
}

module.exports = { testDebugCheats, checkDebugCheats };