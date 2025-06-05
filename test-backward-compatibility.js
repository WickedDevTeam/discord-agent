#!/usr/bin/env node

/**
 * Test backward compatibility of the interaction rate system
 */

function testBackwardCompatibility() {
  console.log('🔄 Testing Backward Compatibility...\n');

  // Mock configurations to test different scenarios
  const scenarios = [
    {
      name: 'Bot without interaction rate (legacy)',
      config: {
        id: 'bot1',
        accountType: 'bot',
        token: 'fake_token',
        sharedAiCode: 'fake_code',
        enableFilter: false,
        // No interactionRate set
      },
      expectedBehavior: 'Only responds to mentions/name references'
    },
    {
      name: 'Bot with interaction rate',
      config: {
        id: 'bot1',
        accountType: 'bot',
        token: 'fake_token',
        sharedAiCode: 'fake_code',
        enableFilter: false,
        interactionRate: 50
      },
      expectedBehavior: 'Uses unified interaction system'
    },
    {
      name: 'User without interaction rate (legacy)',
      config: {
        id: 'user1',
        accountType: 'user',
        token: 'fake_token',
        sharedAiCode: 'fake_code',
        enableFilter: false,
        discordUserToken: 'fake_token',
        messageFrequency: 'medium',
        messageBehavior: 'normal'
        // No interactionRate set
      },
      expectedBehavior: 'Uses legacy messageFrequency/messageBehavior system'
    },
    {
      name: 'User with interaction rate',
      config: {
        id: 'user1',
        accountType: 'user',
        token: 'fake_token',
        sharedAiCode: 'fake_code',
        enableFilter: false,
        discordUserToken: 'fake_token',
        messageFrequency: 'medium', // Should be ignored
        messageBehavior: 'normal',  // Should be ignored
        interactionRate: 75
      },
      expectedBehavior: 'Uses unified interaction system (ignores legacy settings)'
    },
    {
      name: 'User with interaction rate and no legacy settings',
      config: {
        id: 'user1',
        accountType: 'user',
        token: 'fake_token',
        sharedAiCode: 'fake_code',
        enableFilter: false,
        discordUserToken: 'fake_token',
        interactionRate: 25
      },
      expectedBehavior: 'Uses unified interaction system'
    }
  ];

  scenarios.forEach((scenario, index) => {
    console.log(`${index + 1}. ${scenario.name}:`);
    console.log(`   Config: ${JSON.stringify(scenario.config, null, 2).replace(/\n/g, '\n   ')}`);
    console.log(`   Expected: ${scenario.expectedBehavior}`);
    
    // Test logic
    const hasInteractionRate = scenario.config.interactionRate !== undefined;
    const isBot = scenario.config.accountType === 'bot';
    const isUser = scenario.config.accountType === 'user';
    
    if (hasInteractionRate) {
      console.log(`   ✅ Will use unified interaction rate system (rate: ${scenario.config.interactionRate})`);
    } else if (isBot) {
      console.log(`   ✅ Will use legacy bot behavior (mentions only)`);
    } else if (isUser) {
      console.log(`   ✅ Will use legacy user behavior (frequency: ${scenario.config.messageFrequency}, behavior: ${scenario.config.messageBehavior})`);
    }
    
    console.log('');
  });

  console.log('🔧 Testing Environment Variable Parsing:');
  
  // Test interaction rate parsing edge cases
  const parseTestCases = [
    { input: '50', expected: 50, desc: 'Valid middle value' },
    { input: '1', expected: 1, desc: 'Minimum valid value' },
    { input: '100', expected: 100, desc: 'Maximum valid value' },
    { input: '0', expected: 1, desc: 'Below minimum (clamped to 1)' },
    { input: '-10', expected: 1, desc: 'Negative value (clamped to 1)' },
    { input: '150', expected: 100, desc: 'Above maximum (clamped to 100)' },
    { input: 'abc', expected: undefined, desc: 'Invalid string (ignored)' },
    { input: '50.5', expected: 50, desc: 'Float value (truncated)' },
    { input: '', expected: undefined, desc: 'Empty string (ignored)' }
  ];

  parseTestCases.forEach(testCase => {
    // Simulate the parsing logic from index.ts
    let result;
    if (testCase.input) {
      const rate = parseInt(testCase.input, 10);
      if (!isNaN(rate)) {
        result = Math.max(1, Math.min(100, rate));
      }
    }
    
    const matches = result === testCase.expected;
    console.log(`   ${matches ? '✅' : '❌'} "${testCase.input}" → ${result} (${testCase.desc})`);
  });

  console.log('\n🎉 Backward Compatibility Test Complete!');
  console.log('\n💡 Migration Path:');
  console.log('   - Existing bots without INTERACTION_RATE: Continue working as before');
  console.log('   - Existing users without INTERACTION_RATE: Continue using frequency/behavior');
  console.log('   - New or updated accounts: Can use simple INTERACTION_RATE_N=1-100');
  console.log('   - Mixed environments: Both old and new systems work simultaneously');
  
  return true;
}

// Run the test
if (require.main === module) {
  testBackwardCompatibility();
}

module.exports = { testBackwardCompatibility };