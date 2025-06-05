# Kindroid Discord Multi-Account Manager

Tutorial on how to use this repo: https://docs.kindroid.ai/official-discord-bot-integration

A Node.js service that manages multiple Discord accounts (both bots and user accounts), each tied to a unique Kindroid AI persona. The system supports flexible autonomous interactions with intelligent response logic and uses just-in-time message fetching to provide conversation context without storing large message logs.

## Features

- **Multi-account support**: Run multiple Discord bot accounts AND user accounts from a single service
- **Unified interaction system**: Simple 1-100 interaction rate for autonomous responses
- **Intelligent response logic**: Smart content analysis for questions, emotions, and context
- **Kindroid AI integration**: Each account is tied to a unique AI persona
- **Flexible account types**: Use traditional Discord bots or more natural user accounts
- **JIT message fetching**: Dynamically grabs the last ~30 messages for context
- **Realistic timing**: Human-like response delays based on conversation history
- **Smart chain prevention**: Allows account interactions while preventing spam loops
- **Caching**: Minimizes redundant Discord API calls
- **Graceful shutdown**: All accounts disconnect on SIGINT/SIGTERM
- **Configurable NSFW filtering** via environment variables
- **Reddit image attachments**: Accounts can randomly attach images from specified subreddits
- **Debug cheat codes**: Built-in testing features for instant responses and forced images
- **Backward compatibility**: Supports legacy user account configurations

## Prerequisites

- Node.js 16.x or higher
- **For Bot Accounts**: Discord Bot Token(s) from the [Discord Developer Portal](https://discord.com/developers/applications)
- **For User Accounts**: Discord user account tokens (see [User Account Setup](#user-account-setup))
- Kindroid AI API access (API key and share code)

## Setup

1. **Clone the repository**:

   ```bash
   git clone https://github.com/KindroidAI/Kindroid-discord.git
   cd Kindroid-discord
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy and configure .env:

   ```bash
   cp .env.example .env
   ```

4. Fill in your KINDROID_API_KEY, KINDROID_INFER_URL, and account tokens.
   For bots: BOT_TOKEN_n and SHARED_AI_CODE_n
   For users: USER_TOKEN_n and USER_AI_CODE_n

5. Run in development mode:

   ```bash
   npm run dev
   ```

   For production:

   ```bash
   npm run build
   npm start
   ```

## Configuration

Use environment variables to configure your accounts. The service supports both Discord bot accounts and user accounts with identical features.

### Global Configuration
- `KINDROID_INFER_URL`: The Kindroid AI API endpoint (should not change)
- `KINDROID_API_KEY`: Your Kindroid AI API key

### Account Configuration

You can configure any combination of bot accounts and user accounts. Both types have identical features and capabilities.

#### Bot Accounts
```env
# Bot 1 (required)
BOT_TOKEN_1=your_discord_bot_token
SHARED_AI_CODE_1=your_kindroid_persona_code

# Bot 1 (optional)
INTERACTION_RATE_1=50                   # 1-100: How likely to respond autonomously
ENABLE_FILTER_1=true                    # NSFW content filtering
REDDIT_SUBREDDITS_1=aww,EarthPorn      # Comma-separated subreddit list
REDDIT_MIN_MESSAGES_1=5                 # Min messages before image
REDDIT_MAX_MESSAGES_1=10                # Max messages before image
REDDIT_NSFW_1=false                     # Allow NSFW Reddit content
```

#### User Accounts
```env
# User 1 (required)
USER_TOKEN_1=your_discord_user_token
USER_AI_CODE_1=your_kindroid_persona_code

# User 1 (optional) - Same options as bots!
INTERACTION_RATE_1=75                   # 1-100: How likely to respond autonomously
ENABLE_FILTER_1=true                    # NSFW content filtering (shared with bots)
REDDIT_SUBREDDITS_1=aww,cats           # Same Reddit config as bots
REDDIT_MIN_MESSAGES_1=3
REDDIT_MAX_MESSAGES_1=8
REDDIT_NSFW_1=false
```

### Interaction Rate Guide

The `INTERACTION_RATE` determines how likely your account is to respond to messages autonomously:

- **1-20**: Very passive - rarely responds unless mentioned (like a lurker)
- **21-40**: Low interaction - occasional responses to interesting messages  
- **41-60**: Medium interaction - moderate participation in conversations
- **61-80**: High interaction - frequently engages with messages
- **81-100**: Very active - participates enthusiastically in most conversations

**Important Notes:**
- Always responds to direct mentions regardless of interaction rate
- Questions, emotional content, and longer messages boost response probability
- If no interaction rate is set, bots only respond to mentions (legacy behavior)
- User accounts without interaction rate fall back to legacy frequency/behavior settings

### User Account Setup

User accounts provide more natural interactions compared to traditional bots. They can join voice channels, have more flexible permissions, and appear as regular users.

**Important Security Notes:**
- User tokens are more sensitive than bot tokens
- Ensure proper security measures when handling user tokens
- User accounts must comply with Discord's Terms of Service
- Consider using dedicated accounts rather than your primary Discord account

### Legacy User Account Settings (Backward Compatibility)

For existing user account configurations, these legacy settings are still supported:

```env
# Legacy settings (use INTERACTION_RATE instead for new setups)
USER_MESSAGE_FREQUENCY_1=high          # high|medium|low
USER_MESSAGE_BEHAVIOR_1=aggressive     # aggressive|normal|passive
```

### Mixed Account Setup Example

You can run both bots and user accounts simultaneously:

```env
# Global settings
KINDROID_INFER_URL=https://kindroid.ai/api/inference/v1
KINDROID_API_KEY=your_api_key

# Bot Account 1
BOT_TOKEN_1=your_bot_token_1
SHARED_AI_CODE_1=your_bot_persona_code_1
INTERACTION_RATE_1=30

# User Account 1  
USER_TOKEN_1=your_user_token_1
USER_AI_CODE_1=your_user_persona_code_1
INTERACTION_RATE_1=60

# Bot Account 2
BOT_TOKEN_2=your_bot_token_2
SHARED_AI_CODE_2=your_bot_persona_code_2
INTERACTION_RATE_2=80
```

You can create as many accounts as you want by incrementing the number (\_1, \_2, \_3, etc.).

## Advanced Features

### Debug Cheat Codes

Built-in testing features for development and debugging:

1. **Force Reddit Image**: Include `''` (double single quotes) anywhere in your message
   - Account will 100% attach a Reddit image regardless of message count
   - Works for both bot and user accounts
   - Example: "Hello '' world" → forces image attachment

2. **Instant Response**: Include `` ` `` (backtick) anywhere in your message
   - Account responds in ~1 second instead of realistic human timing
   - Useful for rapid testing
   - Example: "Quick test `" → instant response

3. **Combined**: Use both for instant image response
   - Example: "Hello '' quick test `" → instant response with forced image

### Realistic Response Timing

The system implements human-like response delays based on conversation history:
- **Active conversation** (0-1 min since last interaction): 3-25 seconds
- **Recent activity** (1-10 min): 15 seconds - 2 minutes  
- **Moderate gap** (10-30 min): 30 seconds - 4 minutes
- **Longer gap** (30 min - 2 hours): 1-8 minutes
- **Extended gap** (2+ hours): 3-15 minutes

Faster responses for:
- Direct messages
- Questions and urgent content
- Mentions

### Smart Chain Prevention

Accounts can interact with each other naturally while preventing spam:
- Up to 3 consecutive messages allowed per account
- Real user messages reset all chains
- 10-minute inactivity resets chains automatically
- Direct messages bypass chain logic entirely

## Error Handling

- Failed account initialization is logged; other accounts continue to initialize
- Individual account failures don't crash the entire service
- Conversation fetch failures are caught and logged  
- API call errors log diagnostic info and return a friendly user message
- Invalid Reddit configurations are filtered out gracefully
- SIGINT or SIGTERM triggers a graceful shutdown of all accounts

## Troubleshooting

### Account Not Responding
1. **Direct Mentions**: Always mention the account or use its name for guaranteed response
2. **Interaction Rate**: Check if `INTERACTION_RATE_X` is set appropriately (1-100)
   - Too low (1-20): Account will rarely respond autonomously
   - Not set: Bots only respond to mentions (legacy behavior)
3. **Content Factors**: Questions (?), emotional words, and longer messages increase response probability
4. **Chain Limits**: Account may be hitting consecutive message limits (check logs)
5. **Permissions**: Verify account has proper channel permissions
6. **Token Validity**: Ensure tokens are valid and accounts are properly authenticated

### Reddit Images Not Working
1. Check `REDDIT_SUBREDDITS_X` configuration
2. Verify `REDDIT_MIN_MESSAGES_X` and `REDDIT_MAX_MESSAGES_X` are valid numbers
3. Review logs for Reddit API failures
4. Test with debug cheat code: include `''` in a message to force image

### Configuration Issues
1. Ensure required global variables are set: `KINDROID_API_KEY`, `KINDROID_INFER_URL`
2. Check token/AI code pairing:
   - Bots: `BOT_TOKEN_X` + `SHARED_AI_CODE_X`
   - Users: `USER_TOKEN_X` + `USER_AI_CODE_X`
3. Verify numbering is sequential (1, 2, 3...)
4. Check for typos in environment variable names

## Development

### Running Tests

The project includes comprehensive test suites:

```bash
# Test interaction rate calculations
node test-interaction-rate.js

# Test backward compatibility 
node test-backward-compatibility.js

# Test edge cases and error handling
node test-edge-cases.js

# Test integration features
node test-integration.js

# Test Reddit image functionality
node test-reddit-images.js

# Test timing system
node test-timing-system.js

# Test debug cheat codes
node test-debug-cheats.js
```

### Development Commands

```bash
# Development mode with auto-restart
npm run dev

# Type checking and linting
npm run lint
npm run lint:fix

# Build for production
npm run build

# Production mode
npm start
```

## Contributing

1. Fork this repository
2. Create your feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add some amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## License

This project is licensed under the MIT License.
