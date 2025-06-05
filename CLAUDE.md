# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kindroid Discord Multi-Account Manager is a Node.js TypeScript service that runs multiple Discord accounts (both bots and user accounts), each connected to a unique Kindroid AI persona. The system features a unified interaction rate system (1-100) that enables intelligent autonomous responses, implements just-in-time message fetching for conversation context, and supports optional Reddit image attachments. User accounts provide more natural, flexible interactions while maintaining identical functionality to bot accounts.

## Development Commands

### Running the Application
```bash
# Development mode with auto-restart on file changes
npm run dev

# Production mode (builds then runs)
npm run build
npm start

# Build only (outputs to dist/)
npm run build

# Watch mode for TypeScript compilation
npm run watch
```

### Code Quality
```bash
# Run ESLint to check for issues
npm run lint

# Auto-fix ESLint issues where possible
npm run lint:fix
```

### Testing
**Note**: No test suite is currently implemented (`npm test` will exit with error). When implementing tests, update the test script in package.json.

## Architecture & Core Components

### 1. Entry Point (`src/index.ts`)
The application bootstrapper that:
- Loads and validates environment variables via `dotenv`
- Discovers account configurations using numbered env vars (BOT_TOKEN_1/USER_TOKEN_1, SHARED_AI_CODE_1/USER_AI_CODE_1, etc.)
- Validates that each account has both token and AI code defined
- Initializes all accounts concurrently via `initializeAllBots()`
- Sets up graceful shutdown handlers for SIGINT/SIGTERM
- Exits with appropriate error codes on failure

Key functions:
- `loadBotConfigs()`: Iterates through numbered env vars to build bot configurations
- `loadUserConfigs()`: Iterates through numbered env vars to build user account configurations
- `loadAllAccountConfigs()`: Combines and sorts both bot and user configurations
- `validateEnv()`: Ensures required global vars exist and account configs are paired correctly

### 2. Discord Manager (`src/discordManager.ts`)
The heart of the Discord integration, managing:

**Account Lifecycle**:
- Creates Discord clients for both bot and user accounts with appropriate intents (Guilds, GuildMessages, MessageContent, DirectMessages)
- Validates Reddit subreddits on account startup
- Maintains `activeBots` Map for shutdown management (handles both bots and users)

**Message Handling**:
- **Unified Interaction System**: Both bot and user accounts now use the same intelligent response logic
- **Interaction Rate (1-100)**: Simple configuration that determines how likely accounts are to respond autonomously
- **Smart Context Analysis**: Higher response rates for questions, longer messages, and emotional content
- Handles all DMs automatically for both account types
- Implements typing indicators during processing
- Supports both reply (for mentions) and regular send

**Unified Interaction Rate System**:
- **1-20**: Very passive (1-5% base response rate)
- **21-40**: Low interaction (5-15% base response rate)
- **41-60**: Medium interaction (15-30% base response rate)
- **61-80**: High interaction (30-50% base response rate)
- **81-100**: Very active (50-70% base response rate)
- Always responds to direct mentions or name references regardless of rate
- Legacy frequency/behavior settings still supported for backward compatibility

**Account-to-Account Chain Prevention**:
- Tracks consecutive account messages per channel via `accountToAccountChains` Map
- Resets chain after `BOT_CHAIN_INACTIVITY_RESET_MS` (10 minutes)
- Limits chains to `MAX_BOT_CHAIN` (3) messages
- DMs bypass chain logic entirely

**Reddit Image System**:
- Downloads images directly from Reddit and uploads as Discord attachments (no Reddit branding)
- Tracks message counts per channel via `channelMessageTrackers`
- Randomizes target count between min/max for each cycle
- Maintains `recentlySentRedditImagesByChannel` cache (30 images per channel)
- Attempts up to `MAX_UNIQUE_IMAGE_FETCH_ATTEMPTS` (5) to find unseen images
- Validates image size (8MB Discord limit) and content type
- Handles download failures gracefully

**Realistic Response Timing System**:
- Implements human-like response delays based on conversation history
- Tracks last interaction times per channel/user/bot combination via `lastInteractionTimes` Map
- Calculates response delays based on time since last interaction:
  - Active conversation (0-1 min): 3-25 seconds
  - Recent activity (1-10 min): 15 seconds - 2 minutes
  - Moderate gap (10-30 min): 30 seconds - 4 minutes
  - Longer gap (30 min - 2 hours): 1-8 minutes
  - Extended gap (2+ hours): 3-15 minutes
- Shows typing indicator partway through delay (20-60% of total delay)
- Faster responses for DMs and urgent messages (questions, mentions)
- Adds randomization for natural conversation feel
- Auto-cleanup of old interaction data after 24 hours

**Debug Cheat Codes**:
- Include `''` (double single quotes) anywhere in message to force Reddit image attachment
- Include `` ` `` (backtick) anywhere in message to trigger instant response (1s delay)
- Both cheats work in DMs and server channels, useful for testing timing and image systems

**Permission Handling**:
- Checks ViewChannel, SendMessages, ReadMessageHistory permissions
- Additional SendMessagesInThreads check for thread channels

### 3. Message Fetching (`src/messageFetch.ts`)
Implements efficient Discord message retrieval:

**Caching System**:
- `channelCache`: Stores recent messages per channel with timestamps
- `displayNameCache`: Caches user display names (nickname > globalName > username)
- Auto-cleanup when caches exceed 1000 entries

**Display Name Resolution**:
- Fetches guild member for server nicknames
- Falls back through globalName to username
- 1-hour cache duration for display names

**Message Formatting**:
- Sorts messages chronologically (oldest first)
- Replaces bot's own messages with "{{ai}}" username
- Pre-fetches all unique user display names for efficiency

### 4. Kindroid API Integration (`src/kindroidAPI.ts`)
Handles AI response generation:

**Request Processing**:
- Validates non-empty conversation arrays
- Hashes usernames for rate limit headers (handles non-ASCII)
- Strips @everyone/@here mentions from responses

**Error Handling**:
- Returns `rate_limited` type for 429 status
- Throws specific errors from API error messages
- Logs response data/status for debugging

**Security**:
- Uses Bearer token authentication
- Includes hashed username in X-Kindroid-Requester header

### 5. Reddit API Integration (`src/redditAPI.ts`)
Fetches and downloads images from Reddit:

**Rate Limiting**:
- Enforces 1-second minimum between requests
- Implements exponential backoff retry (up to 3 attempts)

**Image Fetching**:
- Supports hot/new/top sort methods (top uses random time windows)
- Filters out videos, removed posts, and non-images
- Handles various image sources (direct URLs, previews, imgur)

**Image Downloading**:
- Downloads images as buffers for direct Discord upload
- Validates content-type is image/*
- Enforces 8MB file size limit (Discord's standard limit)
- 10-second timeout for downloads
- Returns null on any failure for graceful degradation

**URL Processing**:
- Decodes HTML entities in URLs
- Extracts direct image URLs from various Reddit formats
- Prefers mid-resolution images (600-1280px) when available
- Generates descriptive filenames (e.g., `r-aww_abc123.jpg`)

**Validation**:
- Validates subreddits exist on bot startup
- Handles private/missing subreddits gracefully

### 6. Constants (`src/constants.ts`)
Centralizes configuration values:
- Discord embed limits and colors
- Reddit API settings (user agent, rate limits)
- Message tracking durations
- Bot chain limits
- Image cache sizes

### 7. Type Definitions (`src/types.ts`)
Provides TypeScript interfaces for:
- `AccountConfig`: Union type for both bot and user configurations
- `BotConfig`: Core bot configuration with optional Reddit settings
- `UserConfig`: User account configuration with behavior and frequency settings
- `BaseAccountConfig`: Shared configuration properties
- `ConversationMessage`: Message format for AI API
- `KindroidResponse`/`KindroidAIResult`: API response types
- `RedditPost`/`RedditListing`: Reddit API data structures
- `ChannelMessageTracker`: Reddit image timing state
- `RedditImageData`: Image buffer data with metadata for Discord upload

## Environment Configuration

### Required Global Variables
```env
KINDROID_INFER_URL=https://kindroid.ai/api/inference/v1
KINDROID_API_KEY=your_api_key_here
```

### Account Configuration (repeat for each account)

#### Bot Accounts
```env
# Bot 1 (required)
BOT_TOKEN_1=discord_bot_token
SHARED_AI_CODE_1=kindroid_persona_code

# Bot 1 (optional)
INTERACTION_RATE_1=50                   # 1-100: How likely to respond autonomously (50 = medium)
ENABLE_FILTER_1=true|false              # NSFW content filtering
REDDIT_SUBREDDITS_1=aww,EarthPorn      # Comma-separated subreddit list
REDDIT_MIN_MESSAGES_1=5                 # Min messages before image
REDDIT_MAX_MESSAGES_1=10                # Max messages before image
REDDIT_NSFW_1=true|false                # Allow NSFW Reddit content

# Bot 2, 3, etc. follow same pattern
```

#### User Accounts
```env
# User 1 (required)
USER_TOKEN_1=discord_user_token
USER_AI_CODE_1=kindroid_persona_code

# User 1 (optional)
INTERACTION_RATE_1=50                   # 1-100: How likely to respond autonomously (same as bots!)
ENABLE_FILTER_1=true|false              # NSFW content filtering (shared with bots)
REDDIT_SUBREDDITS_1=aww,EarthPorn      # Comma-separated subreddit list (shared with bots)
REDDIT_MIN_MESSAGES_1=5                 # Min messages before image (shared with bots)
REDDIT_MAX_MESSAGES_1=10                # Max messages before image (shared with bots)
REDDIT_NSFW_1=true|false                # Allow NSFW Reddit content (shared with bots)

# Legacy settings (still supported for backward compatibility)
USER_MESSAGE_FREQUENCY_1=high|medium|low    # Legacy: use INTERACTION_RATE_1 instead
USER_MESSAGE_BEHAVIOR_1=aggressive|normal|passive    # Legacy: use INTERACTION_RATE_1 instead

# User 2, 3, etc. follow same pattern
```

**Interaction Rate Guide:**
- **1-20**: Very passive - rarely responds unless mentioned (like a lurker)
- **21-40**: Low interaction - occasional responses to interesting messages
- **41-60**: Medium interaction - moderate participation in conversations
- **61-80**: High interaction - frequently engages with messages
- **81-100**: Very active - participates enthusiastically in most conversations

**Important Notes:**
- At least one account (bot or user) must be configured for the application to start
- Both bot and user accounts now use the same interaction system for consistency
- User accounts require valid Discord user tokens (not bot tokens)
- Interaction rate affects how often accounts respond to non-direct messages
- Always responds to mentions regardless of interaction rate
- Reddit settings are shared between bots and users using the same number suffix

## Data Flow

1. **Message Reception**: Discord.js client receives message event
2. **Permission Check**: Verify account can respond to channel (ViewChannel, SendMessages, etc.)
3. **Chain Prevention**: Reset conversation chains if real user messages detected
4. **Response Logic**: Apply unified interaction rate system for autonomous responses:
   - Always respond to mentions or name references
   - Use interaction rate (1-100) to determine autonomous response probability
   - Boost probability for questions, emotional content, and long messages
5. **Chain Limit Check**: Ensure account hasn't exceeded consecutive message limits
6. **Realistic Timing**: Calculate human-like response delays based on conversation history
7. **Context Fetching**: Retrieve last 30 messages with caching
8. **AI Processing**: Send conversation to Kindroid API
9. **Reddit Image** (optional): Check message count, download image as buffer
10. **Response**: Send AI text + optional image attachment (direct upload)

## Error Handling Patterns

### Graceful Degradation
- Individual account failures don't crash the service
- Failed Reddit fetches don't prevent AI responses
- Invalid subreddits are filtered out at startup
- User account response failures fall back to silent operation

### User-Facing Errors
- Generic "Beep boop" message for unexpected errors
- Rate limits handled silently (no error message)
- Maintains conversational flow despite failures

### Logging Strategy
- Console.error for errors with full context
- Console.warn for non-critical issues (invalid subreddits)
- Console.log for initialization and Reddit config details
- Account type prefixes in all log messages ([bot/user accountId])

## State Management

### Per-Account State
- Discord client instance
- Reddit configuration
- Account-specific behavior settings (user accounts only)
- No cross-account state sharing

### Global State Maps
- `activeBots`: Account ID -> Discord Client (handles both bots and users)
- `dmConversationCounts`: Tracks DM frequency per user/account
- `channelMessageTrackers`: Reddit image countdown per channel
- `recentlySentRedditImagesByChannel`: Image deduplication cache
- `accountToAccountChains`: Account conversation chain tracking (applies to both bots and users)
- `lastInteractionTimes`: Response timing per channel/user/account combination

### Cache Management
- Message cache: 5-second duration
- Display name cache: 1-hour duration  
- Reddit image cache: Last 30 images per channel
- Bot chain tracking: Auto-cleanup after 20 minutes inactivity
- DM conversation counts: Auto-cleanup after 7 days inactivity
- Channel message trackers: Auto-cleanup after 30 days
- Last interaction times: Auto-cleanup after 24 hours
- All caches auto-cleanup at 1000+ entries to prevent unbounded growth

## Deployment Considerations

### Resource Usage
- Each account maintains WebSocket connection to Discord
- Memory scales with number of active channels/users
- Reddit API calls rate-limited to 1/second globally
- Image buffers are temporary (garbage collected after upload)
- All Map caches have periodic cleanup to prevent unbounded growth
- User accounts may generate more activity due to flexible response logic

### Monitoring Points
- Account initialization success/failure (bots and users)
- Kindroid API response times and rate limits
- Reddit fetch success rates
- Memory usage (cache growth)
- User account response rates and patterns

### Security
- Environment variables for sensitive data
- No message content persistence
- Username hashing for rate limit headers
- @everyone/@here mention stripping
- **Important**: User tokens are more sensitive than bot tokens - ensure proper security measures

## Common Debugging Scenarios

### Account Not Responding
1. Check permissions in channel (ViewChannel, SendMessages, ReadMessageHistory)
2. **Direct Messages**: Always mention account or use account name for guaranteed response
3. **Autonomous Responses**: Check interaction rate setting (1-100):
   - Rate too low (1-20): Only responds occasionally to very interesting messages
   - No interaction rate set: Bots only respond to mentions (legacy behavior)
4. **Content Factors**: Questions (?), emotional words, and longer messages get higher response rates
5. Check account-to-account chain limits (may be preventing response)
6. Review Kindroid API logs for rate limits
7. Verify token validity and account permissions

### Reddit Images Not Appearing
1. Verify subreddit configuration and validity
2. Check message count thresholds
3. Review Reddit API fetch errors in logs
4. Confirm image cache isn't filtering all options
5. Check image download failures (file size, timeout, content-type)
6. Verify Discord file upload permissions in channel

### Environment Issues
1. Validate all required env vars present
2. Check account token/AI code pairing:
   - Bot: BOT_TOKEN_N/SHARED_AI_CODE_N
   - User: USER_TOKEN_N/USER_AI_CODE_N
3. Verify KINDROID_API_KEY validity
4. Ensure proper number sequencing (1, 2, 3...)
5. **Interaction Rate**: Verify INTERACTION_RATE_N is between 1-100 if set
6. **Legacy Settings**: Check USER_MESSAGE_FREQUENCY and USER_MESSAGE_BEHAVIOR values if using legacy mode

### Debug Cheat Codes for Testing
1. **Force Reddit Image**: Include `''` (double single quotes) anywhere in your message
   - Account will 100% attach a Reddit image regardless of message count
   - Works even if no Reddit subreddits configured (will log attempt)
   - Useful for testing image download and attachment functionality
   - Works for both bot and user accounts

2. **Instant Response**: Include `` ` `` (backtick) anywhere in your message  
   - Account will respond in ~1 second instead of realistic human timing
   - Typing indicator appears after 200ms
   - Useful for rapid testing without waiting for delays
   - Works for both bot and user accounts

3. **Combined Cheats**: Use both `''` and `` ` `` in same message for instant image response
   - Example: "Hello '' can you help me `?"
   - Account responds instantly with forced Reddit image attachment
   - **Interaction Rate Bypass**: Debug cheats override autonomous response logic entirely