#!/usr/bin/env node

/**
 * Integration test to verify the timing system integrates properly with the built code
 */

const fs = require('fs');
const path = require('path');

async function testIntegration() {
  console.log('🔗 Testing timing system integration...\n');

  try {
    // Check if constants are properly exported
    const { 
      MAX_RESPONSE_DELAY_MS,
      MIN_RESPONSE_DELAY_MS,
      TYPING_INDICATOR_MIN_PERCENTAGE,
      TYPING_INDICATOR_MAX_PERCENTAGE,
      INTERACTION_TRACKING_CLEANUP_THRESHOLD,
      INTERACTION_TRACKING_RETENTION_MS
    } = require('./dist/constants');

    console.log('✅ Constants properly exported from built code');
    console.log(`   - MAX_RESPONSE_DELAY_MS: ${MAX_RESPONSE_DELAY_MS / 1000}s`);
    console.log(`   - MIN_RESPONSE_DELAY_MS: ${MIN_RESPONSE_DELAY_MS / 1000}s`);
    console.log(`   - TYPING_INDICATOR range: ${TYPING_INDICATOR_MIN_PERCENTAGE * 100}%-${TYPING_INDICATOR_MAX_PERCENTAGE * 100}%`);
    console.log(`   - Cleanup threshold: ${INTERACTION_TRACKING_CLEANUP_THRESHOLD} entries`);
    console.log(`   - Retention: ${INTERACTION_TRACKING_RETENTION_MS / (60 * 60 * 1000)} hours`);

    // Verify the discord manager builds and has the required imports
    const discordManagerPath = './dist/discordManager.js';
    if (fs.existsSync(discordManagerPath)) {
      const discordManagerContent = fs.readFileSync(discordManagerPath, 'utf8');
      
      // Check for timing-related code
      const hasTimingConstants = discordManagerContent.includes('MAX_RESPONSE_DELAY_MS');
      const hasRealisticDelay = discordManagerContent.includes('calculateRealisticDelay');
      const hasTypingTimeout = discordManagerContent.includes('typingTimeout');
      const hasInteractionTracking = discordManagerContent.includes('lastInteractionTimes');

      console.log('\n✅ Discord manager integration checks:');
      console.log(`   - Timing constants imported: ${hasTimingConstants ? '✅' : '❌'}`);
      console.log(`   - Realistic delay function: ${hasRealisticDelay ? '✅' : '❌'}`);
      console.log(`   - Typing timeout handling: ${hasTypingTimeout ? '✅' : '❌'}`);
      console.log(`   - Interaction tracking: ${hasInteractionTracking ? '✅' : '❌'}`);

      if (hasTimingConstants && hasRealisticDelay && hasTypingTimeout && hasInteractionTracking) {
        console.log('\n🎉 All integration checks passed!');
        return true;
      } else {
        console.log('\n❌ Some integration checks failed');
        return false;
      }
    } else {
      console.log('\n❌ Discord manager build file not found');
      return false;
    }

  } catch (error) {
    console.error('❌ Integration test failed:', error.message);
    return false;
  }
}

// Run the test
if (require.main === module) {
  testIntegration()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Unexpected error:', error);
      process.exit(1);
    });
}

module.exports = { testIntegration };