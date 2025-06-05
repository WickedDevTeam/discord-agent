# Kindroid Discord Multi-Bot Manager

Tutorial on how to use this repo: https://docs.kindroid.ai/official-discord-bot-integration

A Node.js service that manages multiple Discord bots, each tied to a unique Kindroid AI persona. The system uses just-in-time message fetching to provide conversation context without storing large message logs.

## Features

- **Multi-bot** support: Run multiple Discord bots from a single service
- **Kindroid AI integration**: Each bot is tied to a unique AI persona (via `SHARED_AI_CODE_n`)
- **JIT message fetching**: Dynamically grabs the last ~30 messages for context
- **Caching**: Minimizes redundant Discord API calls
- **Graceful shutdown**: Bots disconnect on SIGINT/SIGTERM
- **Configurable NSFW filtering** via environment variables
- **Reddit image attachments**: Bots can randomly attach images from specified subreddits

## Prerequisites

- Node.js 16.x or higher
- Discord Bot Token(s) from the [Discord Developer Portal](https://discord.com/developers/applications)
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

4. Fill in your KINDROID_API_KEY, KINDROID_INFER_URL, and bot tokens (BOT_TOKEN_n).
   Provide SHARED_AI_CODE_n for each bot's AI persona.

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

Use environment variables to configure your bots. The .env.example file shows usage:

- KINDROID_INFER_URL: The Kindroid AI API endpoint, and should not change
- KINDROID_API_KEY: Your Kindroid AI API key
- SHARED_AI_CODE_n: The share code to identify which AI persona to use for the n-th bot
- BOT_TOKEN_n: Discord bot token for the n-th bot
- ENABLE_FILTER_n: (Optional) true or false to enable NSFW filtering for the n-th bot

### Reddit Image Feature (Optional)

Each bot can be configured to randomly attach images from Reddit:

- REDDIT_SUBREDDITS_n: Comma-separated list of subreddits (e.g., "aww,EarthPorn,Art")
- REDDIT_MIN_MESSAGES_n: Minimum messages before attaching an image (e.g., 5)
- REDDIT_MAX_MESSAGES_n: Maximum messages before attaching an image (e.g., 10)
- REDDIT_NSFW_n: (Optional) true or false to allow NSFW content (default: false)

Example configuration:
```env
# Reddit configuration for Bot 1
REDDIT_SUBREDDITS_1=aww,EarthPorn,FoodPorn,Art
REDDIT_MIN_MESSAGES_1=5
REDDIT_MAX_MESSAGES_1=10
REDDIT_NSFW_1=false
```

The bot will randomly attach an image after a random number of messages between the min and max values. Images are fetched from the specified subreddits and embedded in the Discord message.

You can create as many bots as you want by incrementing the number (\_1, \_2, \_3, etc.).

## Error Handling

- Failed bot initialization is logged; other bots still initialize
- Conversation fetch failures are caught and logged
- API call errors log diagnostic info and return a friendly user message
- SIGINT or SIGTERM triggers a graceful shutdown of all bots

## Contributing

1. Fork this repository
2. Create your feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add some amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## License

This project is licensed under the MIT License.
