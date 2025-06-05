# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kindroid Discord Multi-Bot Manager is a Node.js TypeScript service that runs multiple Discord bots, each connected to a unique Kindroid AI persona. The system implements just-in-time message fetching for conversation context and supports optional Reddit image attachments based on configurable message intervals.

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
- Discovers bot configurations using numbered env vars (BOT_TOKEN_1, SHARED_AI_CODE_1, etc.)
- Validates that each bot has both token and AI code defined
- Initializes all bots concurrently via `initializeAllBots()`
- Sets up graceful shutdown handlers for SIGINT/SIGTERM
- Exits with appropriate error codes on failure

Key functions:
- `loadBotConfigs()`: Iterates through numbered env vars to build bot configurations
- `validateEnv()`: Ensures required global vars exist and bot configs are paired correctly

### 2. Discord Manager (`src/discordManager.ts`)
The heart of the Discord integration, managing:

**Bot Lifecycle**:
- Creates Discord clients with appropriate intents (Guilds, GuildMessages, MessageContent, DirectMessages)
- Validates Reddit subreddits on bot startup
- Maintains `activeBots` Map for shutdown management

**Message Handling**:
- Responds to mentions and bot name references in guilds
- Handles all DMs automatically
- Implements typing indicators during processing
- Supports both reply (for mentions) and regular send

**Bot-to-Bot Chain Prevention**:
- Tracks consecutive bot messages per channel via `botToBotChains` Map
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
- `BotConfig`: Core bot configuration with optional Reddit settings
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

### Bot Configuration (repeat for each bot)
```env
# Bot 1 (required)
BOT_TOKEN_1=discord_bot_token
SHARED_AI_CODE_1=kindroid_persona_code

# Bot 1 (optional)
ENABLE_FILTER_1=true|false              # NSFW content filtering
REDDIT_SUBREDDITS_1=aww,EarthPorn      # Comma-separated subreddit list
REDDIT_MIN_MESSAGES_1=5                 # Min messages before image
REDDIT_MAX_MESSAGES_1=10                # Max messages before image
REDDIT_NSFW_1=true|false                # Allow NSFW Reddit content

# Bot 2, 3, etc. follow same pattern
```

## Data Flow

1. **Message Reception**: Discord.js client receives message event
2. **Validation**: Check bot chains, permissions, and triggers (mention/name)
3. **Context Fetching**: Retrieve last 30 messages with caching
4. **AI Processing**: Send conversation to Kindroid API
5. **Reddit Image** (optional): Check message count, download image as buffer
6. **Response**: Send AI text + optional image attachment (direct upload)

## Error Handling Patterns

### Graceful Degradation
- Individual bot failures don't crash the service
- Failed Reddit fetches don't prevent AI responses
- Invalid subreddits are filtered out at startup

### User-Facing Errors
- Generic "Beep boop" message for unexpected errors
- Rate limits handled silently (no error message)
- Maintains conversational flow despite failures

### Logging Strategy
- Console.error for errors with full context
- Console.warn for non-critical issues (invalid subreddits)
- Console.log for initialization and Reddit config details

## State Management

### Per-Bot State
- Discord client instance
- Reddit configuration
- No cross-bot state sharing

### Global State Maps
- `activeBots`: Bot ID -> Discord Client
- `dmConversationCounts`: Tracks DM frequency per user/bot
- `channelMessageTrackers`: Reddit image countdown per channel
- `recentlySentRedditImagesByChannel`: Image deduplication cache
- `botToBotChains`: Bot conversation chain tracking
- `lastInteractionTimes`: Response timing per channel/user/bot combination

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
- Each bot maintains WebSocket connection to Discord
- Memory scales with number of active channels/users
- Reddit API calls rate-limited to 1/second globally
- Image buffers are temporary (garbage collected after upload)
- All Map caches have periodic cleanup to prevent unbounded growth

### Monitoring Points
- Bot initialization success/failure
- Kindroid API response times and rate limits
- Reddit fetch success rates
- Memory usage (cache growth)

### Security
- Environment variables for sensitive data
- No message content persistence
- Username hashing for rate limit headers
- @everyone/@here mention stripping

## Common Debugging Scenarios

### Bot Not Responding
1. Check permissions in channel (ViewChannel, SendMessages, ReadMessageHistory)
2. Verify mention or name match (case-insensitive)
3. Check bot-to-bot chain limits
4. Review Kindroid API logs for rate limits

### Reddit Images Not Appearing
1. Verify subreddit configuration and validity
2. Check message count thresholds
3. Review Reddit API fetch errors in logs
4. Confirm image cache isn't filtering all options
5. Check image download failures (file size, timeout, content-type)
6. Verify Discord file upload permissions in channel

### Environment Issues
1. Validate all required env vars present
2. Check BOT_TOKEN/SHARED_AI_CODE pairing
3. Verify KINDROID_API_KEY validity
4. Ensure proper number sequencing (1, 2, 3...)

### Debug Cheat Codes for Testing
1. **Force Reddit Image**: Include `''` (double single quotes) anywhere in your message
   - Bot will 100% attach a Reddit image regardless of message count
   - Works even if no Reddit subreddits configured (will log attempt)
   - Useful for testing image download and attachment functionality

2. **Instant Response**: Include `` ` `` (backtick) anywhere in your message  
   - Bot will respond in ~1 second instead of realistic human timing
   - Typing indicator appears after 200ms
   - Useful for rapid testing without waiting for delays

3. **Combined Cheats**: Use both `''` and `` ` `` in same message for instant image response
   - Example: "Hello '' can you help me `?"
   - Bot responds instantly with forced Reddit image attachment