#!/usr/bin/env node

/**
 * Test script for Reddit image functionality
 * Tests the Reddit API integration and image download without requiring Discord
 */

const { getRandomRedditImage, validateSubreddits } = require('./dist/redditAPI');

async function testRedditImageFunctionality() {
    console.log('🧪 Testing Reddit Image Functionality...\n');

    // Test configuration
    const testConfig = {
        subreddits: ['aww', 'EarthPorn', 'Art'],
        minMessages: 1,
        maxMessages: 3,
        nsfw: false
    };

    try {
        // Test 1: Validate subreddits
        console.log('1️⃣ Testing subreddit validation...');
        const validSubreddits = await validateSubreddits(testConfig.subreddits);
        console.log(`✅ Valid subreddits found: ${validSubreddits.join(', ')}`);
        
        if (validSubreddits.length === 0) {
            console.log('❌ No valid subreddits found - network issue or Reddit API problem');
            return false;
        }

        // Update config with valid subreddits
        testConfig.subreddits = validSubreddits;

        // Test 2: Fetch and download random image
        console.log('\n2️⃣ Testing image fetch and download...');
        const imageData = await getRandomRedditImage(testConfig);
        
        if (!imageData) {
            console.log('❌ Failed to fetch image data');
            return false;
        }

        console.log(`✅ Successfully downloaded image:`);
        console.log(`   - ID: ${imageData.id}`);
        console.log(`   - Filename: ${imageData.filename}`);
        console.log(`   - Title: ${imageData.title.substring(0, 50)}${imageData.title.length > 50 ? '...' : ''}`);
        console.log(`   - Subreddit: r/${imageData.subreddit}`);
        console.log(`   - Buffer size: ${imageData.buffer.length} bytes`);

        // Test 3: Validate buffer is actually image data
        console.log('\n3️⃣ Testing image buffer validation...');
        
        // Check if buffer starts with common image signatures
        const isJPEG = imageData.buffer[0] === 0xFF && imageData.buffer[1] === 0xD8;
        const isPNG = imageData.buffer[0] === 0x89 && imageData.buffer[1] === 0x50 && imageData.buffer[2] === 0x4E && imageData.buffer[3] === 0x47;
        const isGIF = imageData.buffer[0] === 0x47 && imageData.buffer[1] === 0x49 && imageData.buffer[2] === 0x46;
        const isWebP = imageData.buffer[8] === 0x57 && imageData.buffer[9] === 0x45 && imageData.buffer[10] === 0x42 && imageData.buffer[11] === 0x50;
        
        if (isJPEG || isPNG || isGIF || isWebP) {
            console.log(`✅ Buffer contains valid image data (${isJPEG ? 'JPEG' : isPNG ? 'PNG' : isGIF ? 'GIF' : 'WebP'})`);
        } else {
            console.log('⚠️  Buffer may not contain valid image data (unknown format)');
        }

        // Test 4: Check file size is within Discord limits
        console.log('\n4️⃣ Testing Discord file size limits...');
        const DISCORD_MAX_SIZE = 8 * 1024 * 1024; // 8MB
        if (imageData.buffer.length <= DISCORD_MAX_SIZE) {
            console.log(`✅ File size within Discord limits (${imageData.buffer.length} / ${DISCORD_MAX_SIZE} bytes)`);
        } else {
            console.log(`❌ File size exceeds Discord limits (${imageData.buffer.length} / ${DISCORD_MAX_SIZE} bytes)`);
            return false;
        }

        // Test 5: Test multiple fetches for uniqueness
        console.log('\n5️⃣ Testing image uniqueness...');
        const secondImage = await getRandomRedditImage(testConfig);
        if (secondImage && secondImage.id !== imageData.id) {
            console.log(`✅ Second fetch returned different image (${secondImage.id})`);
        } else if (secondImage) {
            console.log(`⚠️  Second fetch returned same image (${secondImage.id}) - this is possible with small subreddits`);
        } else {
            console.log('⚠️  Second fetch failed - this may happen occasionally');
        }

        console.log('\n🎉 All Reddit image tests completed successfully!');
        return true;

    } catch (error) {
        console.error('\n❌ Test failed with error:', error.message);
        if (error.stack) {
            console.error('Stack trace:', error.stack);
        }
        return false;
    }
}

// Run the test
if (require.main === module) {
    testRedditImageFunctionality()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            console.error('Unexpected error:', error);
            process.exit(1);
        });
}

module.exports = { testRedditImageFunctionality };