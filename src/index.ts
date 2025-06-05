import dotenv from "dotenv";
import { initializeAllBots, shutdownAllBots } from "./discordManager";
import { BotConfig, UserConfig, AccountConfig, RedditImageConfig } from "./types";

dotenv.config();

/**
 * Load user account configurations from environment variables
 * Looks for pairs of USER_AI_CODE_N and USER_TOKEN_N where N starts from 1
 * @returns Array of user account configurations
 */
function loadUserConfigs(): UserConfig[] {
  const configs: UserConfig[] = [];
  let currentIndex = 1;

  let hasMoreConfigs = true;
  while (hasMoreConfigs) {
    const sharedAiCode = process.env[`USER_AI_CODE_${currentIndex}`];
    const userToken = process.env[`USER_TOKEN_${currentIndex}`];

    // If either required value is missing, we've reached the end of our configs
    if (!sharedAiCode || !userToken) {
      hasMoreConfigs = false;
      break;
    }

    // Get optional settings (shared with bot configs)
    const enableFilter =
      process.env[`ENABLE_FILTER_${currentIndex}`]?.toLowerCase() === "true";
    
    // Parse interaction rate (1-100, unified system for autonomous responses)
    const interactionRateStr = process.env[`INTERACTION_RATE_${currentIndex}`];
    let interactionRate: number | undefined;
    if (interactionRateStr) {
      const rate = parseInt(interactionRateStr, 10);
      if (!isNaN(rate)) {
        interactionRate = Math.max(1, Math.min(100, rate)); // Clamp to 1-100
      }
    }
    
    // Legacy settings for backward compatibility
    const messageFrequency = process.env[`USER_MESSAGE_FREQUENCY_${currentIndex}`] as 'high' | 'medium' | 'low' | undefined;
    const messageBehavior = process.env[`USER_MESSAGE_BEHAVIOR_${currentIndex}`] as 'normal' | 'aggressive' | 'passive' | undefined;

    // Get Reddit configuration if available (shared logic)
    let redditConfig: RedditImageConfig | undefined;
    const redditSubreddits = process.env[`REDDIT_SUBREDDITS_${currentIndex}`];
    const redditMinMessages = process.env[`REDDIT_MIN_MESSAGES_${currentIndex}`];
    const redditMaxMessages = process.env[`REDDIT_MAX_MESSAGES_${currentIndex}`];
    const redditNSFW = process.env[`REDDIT_NSFW_${currentIndex}`]?.toLowerCase() === "true";

    if (redditSubreddits && redditMinMessages && redditMaxMessages) {
      const minMessages = parseInt(redditMinMessages, 10);
      const maxMessages = parseInt(redditMaxMessages, 10);
      
      // Validate parsed numbers
      if (!isNaN(minMessages) && !isNaN(maxMessages)) {
        redditConfig = {
          subreddits: redditSubreddits.split(",").map((s) => s.trim()).filter((s) => s.length > 0),
          minMessages: Math.max(1, minMessages), // Ensure at least 1
          maxMessages: Math.max(minMessages, maxMessages), // Ensure max >= min
          nsfw: redditNSFW || false,
        };
        
        // Log configuration
        console.log(`[User ${currentIndex}] Reddit config: ${redditConfig.subreddits.length} subreddits, ${redditConfig.minMessages}-${redditConfig.maxMessages} messages, NSFW: ${redditConfig.nsfw}`);
      } else {
        console.warn(`[User ${currentIndex}] Invalid Reddit message counts, skipping Reddit feature`);
      }
    }

    configs.push({
      id: `user${currentIndex}`,
      accountType: 'user',
      token: userToken,
      discordUserToken: userToken,
      sharedAiCode,
      enableFilter,
      redditConfig,
      interactionRate,
      messageFrequency, // Legacy
      messageBehavior, // Legacy
    });

    currentIndex++;
  }

  return configs;
}

/**
 * Load bot configurations from environment variables
 * Looks for pairs of SHARED_AI_CODE_N and BOT_TOKEN_N where N starts from 1
 * @returns Array of bot configurations
 */
function loadBotConfigs(): BotConfig[] {
  const configs: BotConfig[] = [];
  let currentIndex = 1;

  let hasMoreConfigs = true;
  while (hasMoreConfigs) {
    const sharedAiCode = process.env[`SHARED_AI_CODE_${currentIndex}`];
    const botToken = process.env[`BOT_TOKEN_${currentIndex}`];

    // If either required value is missing, we've reached the end of our configs
    if (!sharedAiCode || !botToken) {
      hasMoreConfigs = false;
      break;
    }

    // Get optional settings
    const enableFilter =
      process.env[`ENABLE_FILTER_${currentIndex}`]?.toLowerCase() === "true";
    
    // Parse interaction rate (1-100, unified system for autonomous responses)
    const interactionRateStr = process.env[`INTERACTION_RATE_${currentIndex}`];
    let interactionRate: number | undefined;
    if (interactionRateStr) {
      const rate = parseInt(interactionRateStr, 10);
      if (!isNaN(rate)) {
        interactionRate = Math.max(1, Math.min(100, rate)); // Clamp to 1-100
      }
    }

    // Get Reddit configuration if available
    let redditConfig: RedditImageConfig | undefined;
    const redditSubreddits = process.env[`REDDIT_SUBREDDITS_${currentIndex}`];
    const redditMinMessages = process.env[`REDDIT_MIN_MESSAGES_${currentIndex}`];
    const redditMaxMessages = process.env[`REDDIT_MAX_MESSAGES_${currentIndex}`];
    const redditNSFW = process.env[`REDDIT_NSFW_${currentIndex}`]?.toLowerCase() === "true";

    if (redditSubreddits && redditMinMessages && redditMaxMessages) {
      const minMessages = parseInt(redditMinMessages, 10);
      const maxMessages = parseInt(redditMaxMessages, 10);
      
      // Validate parsed numbers
      if (!isNaN(minMessages) && !isNaN(maxMessages)) {
        redditConfig = {
          subreddits: redditSubreddits.split(",").map((s) => s.trim()).filter((s) => s.length > 0),
          minMessages: Math.max(1, minMessages), // Ensure at least 1
          maxMessages: Math.max(minMessages, maxMessages), // Ensure max >= min
          nsfw: redditNSFW || false,
        };
        
        // Log configuration
        console.log(`[Bot ${currentIndex}] Reddit config: ${redditConfig.subreddits.length} subreddits, ${redditConfig.minMessages}-${redditConfig.maxMessages} messages, NSFW: ${redditConfig.nsfw}`);
      } else {
        console.warn(`[Bot ${currentIndex}] Invalid Reddit message counts, skipping Reddit feature`);
      }
    }

    configs.push({
      id: `bot${currentIndex}`,
      accountType: 'bot',
      token: botToken,
      discordBotToken: botToken,
      sharedAiCode,
      enableFilter,
      redditConfig,
      interactionRate,
    });

    currentIndex++;
  }

  return configs;
}

/**
 * Load all account configurations (both bots and users) from environment variables
 * @returns Array of all account configurations sorted by ID
 */
function loadAllAccountConfigs(): AccountConfig[] {
  const botConfigs = loadBotConfigs();
  const userConfigs = loadUserConfigs();
  
  // Combine and sort by ID to maintain consistent ordering
  const allConfigs: AccountConfig[] = [...botConfigs, ...userConfigs];
  allConfigs.sort((a, b) => a.id.localeCompare(b.id));
  
  return allConfigs;
}

/**
 * Validate environment variables
 * @throws Error if required variables are missing
 */
function validateEnv(): void {
  const requiredVars = [
    "KINDROID_INFER_URL",
    "KINDROID_API_KEY",
  ] as const;

  const missing = requiredVars.filter((varName) => !process.env[varName]);

  if (missing.length > 0) {
    console.error(
      "Missing required environment variables:",
      missing.join(", ")
    );
    process.exit(1);
  }

  // Check that at least one account is configured (bot or user)
  const hasBot1 = !!process.env[`SHARED_AI_CODE_1`] && !!process.env[`BOT_TOKEN_1`];
  const hasUser1 = !!process.env[`USER_AI_CODE_1`] && !!process.env[`USER_TOKEN_1`];
  
  if (!hasBot1 && !hasUser1) {
    console.error(
      "Error: At least one account must be configured. Please set either BOT_TOKEN_1 & SHARED_AI_CODE_1 or USER_TOKEN_1 & USER_AI_CODE_1"
    );
    process.exit(1);
  }

  // Validate bot config pairs
  let currentIndex = 1;
  let hasMoreConfigs = true;
  while (hasMoreConfigs) {
    const hasSharedAiCode = !!process.env[`SHARED_AI_CODE_${currentIndex}`];
    const hasBotToken = !!process.env[`BOT_TOKEN_${currentIndex}`];

    // If neither exists, we're done checking bots
    if (!hasSharedAiCode && !hasBotToken) {
      hasMoreConfigs = false;
      break;
    }

    // If one exists without the other, that's an error
    if (hasSharedAiCode !== hasBotToken) {
      console.error(
        `Error: Bot ${currentIndex} must have both SHARED_AI_CODE_${currentIndex} and BOT_TOKEN_${currentIndex} defined`
      );
      process.exit(1);
    }

    currentIndex++;
  }

  // Validate user config pairs
  currentIndex = 1;
  hasMoreConfigs = true;
  while (hasMoreConfigs) {
    const hasUserAiCode = !!process.env[`USER_AI_CODE_${currentIndex}`];
    const hasUserToken = !!process.env[`USER_TOKEN_${currentIndex}`];

    // If neither exists, we're done checking users
    if (!hasUserAiCode && !hasUserToken) {
      hasMoreConfigs = false;
      break;
    }

    // If one exists without the other, that's an error
    if (hasUserAiCode !== hasUserToken) {
      console.error(
        `Error: User ${currentIndex} must have both USER_AI_CODE_${currentIndex} and USER_TOKEN_${currentIndex} defined`
      );
      process.exit(1);
    }

    currentIndex++;
  }
}

async function main(): Promise<void> {
  try {
    // Validate environment
    validateEnv();

    // Load all account configurations (bots and users)
    const accountConfigs = loadAllAccountConfigs();

    if (accountConfigs.length === 0) {
      console.error(
        "No valid account configurations found in environment variables"
      );
      process.exit(1);
    }

    const botCount = accountConfigs.filter(config => config.accountType === 'bot').length;
    const userCount = accountConfigs.filter(config => config.accountType === 'user').length;
    console.log(`Found ${accountConfigs.length} account configurations: ${botCount} bots, ${userCount} users`);

    // Initialize all accounts
    await initializeAllBots(accountConfigs);
    console.log("All accounts initialized successfully!");

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
      console.log("\nReceived SIGINT. Shutting down...");
      await shutdownAllBots();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      console.log("\nReceived SIGTERM. Shutting down...");
      await shutdownAllBots();
      process.exit(0);
    });
  } catch (error) {
    console.error("Fatal error during initialization:", error);
    process.exit(1);
  }
}

// Start the application
main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
