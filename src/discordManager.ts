import {
  Client,
  GatewayIntentBits,
  Message,
  TextChannel,
  DMChannel,
  ChannelType,
  BaseGuildTextChannel,
  PermissionFlagsBits,
  Partials,
  MessageCreateOptions,
  AttachmentBuilder,
} from "discord.js";
import { ephemeralFetchConversation } from "./messageFetch";
import { callKindroidAI } from "./kindroidAPI";
import { BotConfig, UserConfig, AccountConfig, DMConversationCount, ChannelMessageTracker, RedditImageData } from "./types";
import { getRandomRedditImage, validateSubreddits } from "./redditAPI";
import {
  CHANNEL_CACHE_DURATION_MS,
  DM_FETCH_LIMIT,
  MAX_BOT_CHAIN,
  BOT_CHAIN_INACTIVITY_RESET_MS,
  RECENTLY_SENT_IMAGE_CACHE_SIZE,
  MAX_UNIQUE_IMAGE_FETCH_ATTEMPTS,
  INTERACTION_TRACKING_CLEANUP_THRESHOLD,
  INTERACTION_TRACKING_RETENTION_MS,
  MAX_RESPONSE_DELAY_MS,
  MIN_RESPONSE_DELAY_MS,
  TYPING_INDICATOR_MIN_PERCENTAGE,
  TYPING_INDICATOR_MAX_PERCENTAGE,
  DEVELOPMENT_MODE,
  DEVELOPMENT_MAX_DELAY_MS,
} from "./constants";

//Account back and forth (prevent infinite loop but allow for mentioning other accounts in conversation)
type AccountConversationChain = {
  chainCount: number; // how many consecutive account messages
  lastAccountId: string; // ID of the last account
  lastActivity: number; // timestamp of last message in chain
};

const accountToAccountChains = new Map<string, AccountConversationChain>();

// Track active bot instances
const activeBots = new Map<string, Client>();

// Track DM conversation counts with proper typing
const dmConversationCounts = new Map<string, DMConversationCount>();

// Track message counts for Reddit image feature
const channelMessageTrackers = new Map<string, ChannelMessageTracker>();

// Cache for recently sent Reddit image IDs by channel
const recentlySentRedditImagesByChannel = new Map<string, string[]>();

// Track last interaction times for realistic response delays
const lastInteractionTimes = new Map<string, number>();

// Helper function to check if our account can respond based on recent account activity
function shouldAllowAccountResponse(channelId: string, ourAccountId: string): boolean {
  // If in DM, skip chain logic entirely
  if (!channelId) {
    return true;
  }

  // Get (or initialize) the chain data for this channel
  const chainData = accountToAccountChains.get(channelId) || {
    chainCount: 0,
    lastAccountId: "",
    lastActivity: 0,
  };

  const now = Date.now();
  const timeSinceLast = now - chainData.lastActivity;

  // If too much time passed, reset the chain
  if (timeSinceLast > BOT_CHAIN_INACTIVITY_RESET_MS) {
    chainData.chainCount = 0;
    chainData.lastAccountId = "";
  }

  // If our account was the last one to send a message, check chain count
  if (chainData.lastAccountId && chainData.lastAccountId === ourAccountId) {
    // If we've hit the chain limit, don't allow response
    if (chainData.chainCount >= MAX_BOT_CHAIN) {
      return false;
    }
    // Increment count for this response
    chainData.chainCount++;
  } else {
    // Different account last responded, reset count
    chainData.chainCount = 1;
  }

  // Update tracking for our response
  chainData.lastAccountId = ourAccountId;
  chainData.lastActivity = now;
  accountToAccountChains.set(channelId, chainData);
  
  // Clean up old entries periodically to prevent unbounded growth
  if (accountToAccountChains.size > 1000) {
    const oldestAllowed = now - BOT_CHAIN_INACTIVITY_RESET_MS * 2; // Keep entries for 2x inactivity period
    for (const [key, value] of accountToAccountChains.entries()) {
      if (value.lastActivity < oldestAllowed) {
        accountToAccountChains.delete(key);
      }
    }
  }
  
  return true;
}

// Helper function to check if the bot can respond to a channel before responding
async function canRespondToChannel(
  channel: Message["channel"]
): Promise<boolean> {
  try {
    // For DM channels, we only need to check if we can send messages
    if (channel.type === ChannelType.DM) {
      return true;
    }

    // For all guild-based channels that support messages
    if (channel.isTextBased() && !channel.isDMBased()) {
      const permissions = channel.permissionsFor(channel.client.user);
      if (!permissions) return false;

      // Basic permissions needed for any text-based channel
      const requiredPermissions = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ];

      // Add thread permissions if the channel is a thread
      if (channel.isThread()) {
        requiredPermissions.push(PermissionFlagsBits.SendMessagesInThreads);
      }

      return permissions.has(requiredPermissions);
    }

    return false;
  } catch (error) {
    console.error("Error checking permissions:", error);
    return false;
  }
}

/**
 * Calculates a realistic response delay based on time since last interaction
 * @param timeSinceLastMs - Milliseconds since last interaction
 * @param isDM - Whether this is a direct message
 * @param isUrgent - Whether the message seems urgent (question, mention)
 * @returns Delay in milliseconds before responding
 */
function calculateRealisticDelay(
  timeSinceLastMs: number,
  isDM: boolean = false,
  isUrgent: boolean = false
): number {
  // Handle edge cases
  const safeSinceLastMs = Math.max(0, timeSinceLastMs);
  const minutesSinceLast = safeSinceLastMs / (60 * 1000);
  
  let baseDelayRange: [number, number]; // [min, max] in seconds
  
  if (minutesSinceLast < 1) {
    // Active conversation - very quick responses
    baseDelayRange = [3, 25];
  } else if (minutesSinceLast < 10) {
    // Recent activity - still relatively quick
    baseDelayRange = [15, 120];
  } else if (minutesSinceLast < 30) {
    // Moderate gap - took a bit to notice
    baseDelayRange = [30, 240];
  } else if (minutesSinceLast < 120) {
    // Longer gap - was away for a while
    baseDelayRange = [60, 480];
  } else {
    // Extended gap - significant time away
    baseDelayRange = [180, 900];
  }
  
  // Adjust for DMs (generally faster response due to notifications)
  if (isDM) {
    baseDelayRange[0] = Math.max(2, Math.floor(baseDelayRange[0] * 0.7));
    baseDelayRange[1] = Math.floor(baseDelayRange[1] * 0.8);
  }
  
  // Adjust for urgent messages (questions, mentions)
  if (isUrgent) {
    baseDelayRange[0] = Math.max(2, Math.floor(baseDelayRange[0] * 0.8));
    baseDelayRange[1] = Math.floor(baseDelayRange[1] * 0.9);
  }
  
  // Add some randomization for natural feel
  const [minDelay, maxDelay] = baseDelayRange;
  const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
  const delayMs = randomDelay * 1000; // Convert to milliseconds
  
  // Apply hard limits to prevent excessive delays
  const hardMaxDelay = DEVELOPMENT_MODE ? DEVELOPMENT_MAX_DELAY_MS : MAX_RESPONSE_DELAY_MS;
  return Math.min(Math.max(delayMs, MIN_RESPONSE_DELAY_MS), hardMaxDelay);
}

/**
 * Determines when to show typing indicator during response delay
 * @param totalDelayMs - Total delay before responding
 * @returns Delay before showing typing indicator
 */
function calculateTypingDelay(totalDelayMs: number): number {
  // Show typing indicator somewhere between configured percentage range
  const typingPercentage = TYPING_INDICATOR_MIN_PERCENTAGE + 
    Math.random() * (TYPING_INDICATOR_MAX_PERCENTAGE - TYPING_INDICATOR_MIN_PERCENTAGE);
  return Math.floor(totalDelayMs * typingPercentage);
}

/**
 * Checks if a message seems urgent based on content
 * @param content - Message content
 * @param isMentioned - Whether account was mentioned
 * @returns Whether message seems urgent
 */
function isMessageUrgent(content: string, isMentioned: boolean): boolean {
  if (isMentioned) return true;
  
  const urgentPatterns = [
    /\?/, // Questions
    /help/i,
    /urgent/i,
    /quick/i,
    /asap/i,
    /emergency/i
  ];
  
  return urgentPatterns.some(pattern => pattern.test(content));
}

/**
 * Determines if an account should respond to a message based on its interaction rate and context
 * @param message - The Discord message
 * @param accountConfig - Account configuration (bot or user)
 * @param isMentioned - Whether the account was mentioned
 * @param containsAccountName - Whether the message contains the account name
 * @returns Whether the account should respond
 */
function shouldAccountRespond(
  message: Message,
  accountConfig: AccountConfig,
  isMentioned: boolean,
  containsAccountName: boolean
): boolean {
  // Always respond to mentions or name references
  if (isMentioned || containsAccountName) {
    return true;
  }

  // If no interaction rate is set, use legacy behavior
  if (accountConfig.interactionRate === undefined) {
    // Bot accounts without interaction rate: only respond to mentions (old behavior)
    if (accountConfig.accountType === 'bot') {
      return false;
    }
    
    // User accounts without interaction rate: use legacy frequency/behavior system
    if (accountConfig.accountType === 'user') {
      return shouldLegacyUserAccountRespond(message, accountConfig, isMentioned, containsAccountName);
    }
  }

  // Unified interaction rate system (1-100)
  const interactionRate = accountConfig.interactionRate || 0;
  
  // Convert interaction rate to base response probability
  // 1-20: Very passive (1-5% base chance)
  // 21-40: Low interaction (5-15% base chance)  
  // 41-60: Medium interaction (15-30% base chance)
  // 61-80: High interaction (30-50% base chance)
  // 81-100: Very high interaction (50-70% base chance)
  let baseResponseChance = 0;
  if (interactionRate <= 20) {
    baseResponseChance = (interactionRate / 20) * 0.05; // 0-5%
  } else if (interactionRate <= 40) {
    baseResponseChance = 0.05 + ((interactionRate - 20) / 20) * 0.10; // 5-15%
  } else if (interactionRate <= 60) {
    baseResponseChance = 0.15 + ((interactionRate - 40) / 20) * 0.15; // 15-30%
  } else if (interactionRate <= 80) {
    baseResponseChance = 0.30 + ((interactionRate - 60) / 20) * 0.20; // 30-50%
  } else {
    baseResponseChance = 0.50 + ((interactionRate - 80) / 20) * 0.20; // 50-70%
  }

  // Boost response chance for questions
  const isQuestion = /\?/.test(message.content);
  if (isQuestion) {
    baseResponseChance *= 1.8; // Questions are much more likely to get responses
  }

  // Additional factors that increase response likelihood
  const messageLength = message.content.length;
  const isLongMessage = messageLength > 100; // Longer messages might warrant responses
  const containsEmotions = /(!|\?|wow|amazing|great|terrible|awful|love|hate|awesome|fantastic|horrible)/i.test(message.content);
  const isExclamation = /!/.test(message.content);
  
  if (isLongMessage) baseResponseChance *= 1.3;
  if (containsEmotions) baseResponseChance *= 1.4;
  if (isExclamation && !isQuestion) baseResponseChance *= 1.2;

  // Cap the response chance at 80% for non-direct messages to maintain natural conversation flow
  baseResponseChance = Math.min(baseResponseChance, 0.8);

  // Check if account should respond based on calculated probability
  return Math.random() < baseResponseChance;
}

/**
 * Legacy function for user accounts without interaction rate set
 * @param message - The Discord message
 * @param userConfig - User account configuration
 * @param isMentioned - Whether the user account was mentioned
 * @param containsAccountName - Whether the message contains the account name
 * @returns Whether the user account should respond
 */
function shouldLegacyUserAccountRespond(
  message: Message,
  userConfig: UserConfig,
  isMentioned: boolean,
  containsAccountName: boolean
): boolean {
  // Always respond to mentions or name references
  if (isMentioned || containsAccountName) {
    return true;
  }

  // Check if this is a question directed at the channel (likely wants a response)
  const isQuestion = /\?/.test(message.content);
  if (isQuestion) {
    // More likely to respond to questions based on message behavior
    const questionResponseChance = userConfig.messageBehavior === 'aggressive' ? 0.7 : 
                                   userConfig.messageBehavior === 'passive' ? 0.2 : 0.4;
    if (Math.random() < questionResponseChance) {
      return true;
    }
  }

  // Check message frequency settings to determine base response probability
  let baseResponseChance = 0;
  switch (userConfig.messageFrequency) {
    case 'high':
      baseResponseChance = 0.3; // 30% chance to respond to regular messages
      break;
    case 'medium':
      baseResponseChance = 0.15; // 15% chance
      break;
    case 'low':
      baseResponseChance = 0.05; // 5% chance
      break;
    default:
      baseResponseChance = 0.1; // 10% default
  }

  // Adjust based on message behavior
  switch (userConfig.messageBehavior) {
    case 'aggressive':
      baseResponseChance *= 1.5; // 50% more likely to respond
      break;
    case 'passive':
      baseResponseChance *= 0.5; // 50% less likely to respond
      break;
    case 'normal':
    default:
      // No adjustment
      break;
  }

  // Cap the response chance at 50% for non-direct messages
  baseResponseChance = Math.min(baseResponseChance, 0.5);

  // Additional factors that increase response likelihood
  const messageLength = message.content.length;
  const isLongMessage = messageLength > 100; // Longer messages might warrant responses
  const containsEmotions = /(!|\?|wow|amazing|great|terrible|awful|love|hate)/i.test(message.content);
  
  if (isLongMessage) baseResponseChance *= 1.2;
  if (containsEmotions) baseResponseChance *= 1.3;

  // Check if user account should respond based on calculated probability
  return Math.random() < baseResponseChance;
}

/**
 * Checks for debug cheat codes in message content
 * @param content - Message content to check
 * @returns Object with debug flags
 */
function checkDebugCheats(content: string): { forceImage: boolean; instantResponse: boolean } {
  return {
    forceImage: content.includes("''"), // Double single quotes forces image
    instantResponse: content.includes("`")  // Backtick forces instant response
  };
}

/**
 * Gets the interaction key for tracking last interaction times
 * @param channelId - Channel ID
 * @param userId - User ID
 * @param botId - Bot ID
 * @returns Unique key for this interaction pair
 */
function getInteractionKey(channelId: string, userId: string, botId: string): string {
  return `${channelId}:${userId}:${botId}`;
}

/**
 * Updates the last interaction time for a channel/user/bot combination
 * @param channelId - Channel ID
 * @param userId - User ID  
 * @param botId - Bot ID
 */
function updateLastInteractionTime(channelId: string, userId: string, botId: string): void {
  const key = getInteractionKey(channelId, userId, botId);
  const now = Date.now();
  lastInteractionTimes.set(key, now);
  
  // Clean up old interaction times periodically
  if (lastInteractionTimes.size > INTERACTION_TRACKING_CLEANUP_THRESHOLD) {
    const oldestAllowed = now - INTERACTION_TRACKING_RETENTION_MS;
    for (const [interactionKey, timestamp] of lastInteractionTimes.entries()) {
      if (timestamp < oldestAllowed) {
        lastInteractionTimes.delete(interactionKey);
      }
    }
  }
}

/**
 * Checks if a Reddit image should be attached based on message count
 * @param channelId - The channel ID
 * @param accountConfig - The account configuration
 * @param forceImage - Debug cheat to force image attachment
 * @returns Whether to attach an image
 */
function shouldAttachRedditImage(
  channelId: string,
  accountConfig: AccountConfig,
  forceImage: boolean = false
): boolean {
  if (!accountConfig.redditConfig || accountConfig.redditConfig.subreddits.length === 0) {
    return false;
  }
  
  // Debug cheat: force image if double quotes detected
  if (forceImage) {
    console.log(`[${accountConfig.accountType} ${accountConfig.id}] Debug cheat activated - forcing Reddit image attachment`);
    return true;
  }

  const now = Date.now();
  const tracker = channelMessageTrackers.get(channelId);
  if (!tracker) {
    // Initialize tracker for new channel
    const targetCount = Math.floor(
      Math.random() * (accountConfig.redditConfig.maxMessages - accountConfig.redditConfig.minMessages + 1) +
      accountConfig.redditConfig.minMessages
    );
    channelMessageTrackers.set(channelId, {
      messageCount: 1,
      targetMessageCount: targetCount,
      lastImageTime: 0,
    });
    
    // Clean up old channel trackers periodically
    if (channelMessageTrackers.size > 1000) {
      const oldestAllowed = now - 30 * 24 * 60 * 60 * 1000; // Keep data for 30 days
      for (const [key, value] of channelMessageTrackers.entries()) {
        if (value.lastImageTime > 0 && value.lastImageTime < oldestAllowed) {
          channelMessageTrackers.delete(key);
          // Also clean up the corresponding image cache
          recentlySentRedditImagesByChannel.delete(key);
        }
      }
    }
    
    return false;
  }

  // Increment message count
  tracker.messageCount++;

  // Check if we've reached the target
  if (tracker.messageCount >= tracker.targetMessageCount) {
    // Reset counter with new random target
    tracker.messageCount = 0;
    tracker.targetMessageCount = Math.floor(
      Math.random() * (accountConfig.redditConfig.maxMessages - accountConfig.redditConfig.minMessages + 1) +
      accountConfig.redditConfig.minMessages
    );
    tracker.lastImageTime = now;
    return true;
  }

  return false;
}

/**
 * Fetches a random Reddit image that hasn't been recently sent in the channel.
 * @param accountConfig Configuration for this account instance
 * @param channelId The ID of the channel where the image will be sent
 * @returns An image data object or null if no suitable image is found.
 */
async function getUnseenRandomRedditImage(
  accountConfig: AccountConfig,
  channelId: string
): Promise<RedditImageData | null> {
  if (!accountConfig.redditConfig || accountConfig.redditConfig.subreddits.length === 0) {
    return null; // No Reddit config or no subreddits
  }

  const recentlySentIds = recentlySentRedditImagesByChannel.get(channelId) || [];

  for (let attempt = 0; attempt < MAX_UNIQUE_IMAGE_FETCH_ATTEMPTS; attempt++) {
    const image = await getRandomRedditImage(accountConfig.redditConfig);

    if (!image) {
      // getRandomRedditImage itself failed to find anything (e.g., all subreddits failed)
      // No need to log here as getRandomRedditImage already logs its failures.
      if (attempt === 0) console.log(`[${accountConfig.accountType} ${accountConfig.id}] Initial image fetch failed for channel ${channelId}.`);
      continue; // Try fetching again
    }

    if (!recentlySentIds.includes(image.id)) {
      // Found an image not in the recently sent list for this channel
      const updatedSentIds = [image.id, ...recentlySentIds].slice(0, RECENTLY_SENT_IMAGE_CACHE_SIZE);
      recentlySentRedditImagesByChannel.set(channelId, updatedSentIds);
      console.log(`[${accountConfig.accountType} ${accountConfig.id}] Found new image ${image.id} for channel ${channelId}. Cache updated.`);
      return image;
    }

    console.log(`[${accountConfig.accountType} ${accountConfig.id}] Image ${image.id} (r/${image.subreddit}) was recently sent in channel ${channelId}. Attempt ${attempt + 1}/${MAX_UNIQUE_IMAGE_FETCH_ATTEMPTS}.`);
  }

  // If all attempts result in recently sent images or failures, try one last time.
  // If this last one is still a repeat, send it anyway to prioritize sending *something*.
  // If this last fetch fails, then send nothing.
  console.log(`[${accountConfig.accountType} ${accountConfig.id}] Could not find a unique image for channel ${channelId} after ${MAX_UNIQUE_IMAGE_FETCH_ATTEMPTS} attempts. Fetching one last time.`);
  const lastAttemptImage = await getRandomRedditImage(accountConfig.redditConfig);

  if (lastAttemptImage) {
    const updatedSentIds = [lastAttemptImage.id, ...recentlySentIds].slice(0, RECENTLY_SENT_IMAGE_CACHE_SIZE);
    recentlySentRedditImagesByChannel.set(channelId, updatedSentIds);
    console.log(`[${accountConfig.accountType} ${accountConfig.id}] Using last-attempt image ${lastAttemptImage.id} for channel ${channelId}. Cache updated.`);
    return lastAttemptImage;
  }
  
  console.log(`[${accountConfig.accountType} ${accountConfig.id}] All attempts to fetch an image (unique or not) failed for channel ${channelId}. No image will be sent.`);
  return null;
}

/**
 * Creates and initializes a Discord client for a specific account configuration
 * @param accountConfig - Configuration for this account instance (bot or user)
 */
async function createDiscordClient(
  accountConfig: AccountConfig
): Promise<Client> {
  // Validate Reddit subreddits if configured
  if (accountConfig.redditConfig && accountConfig.redditConfig.subreddits.length > 0) {
    console.log(`[${accountConfig.accountType} ${accountConfig.id}] Validating Reddit subreddits...`);
    const validSubreddits = await validateSubreddits(accountConfig.redditConfig.subreddits);
    
    if (validSubreddits.length === 0) {
      console.warn(`[${accountConfig.accountType} ${accountConfig.id}] No valid subreddits found. Reddit image feature disabled.`);
      accountConfig.redditConfig.subreddits = [];
    } else {
      accountConfig.redditConfig.subreddits = validSubreddits;
      console.log(`[${accountConfig.accountType} ${accountConfig.id}] Valid subreddits: ${validSubreddits.join(", ")}`);
    }
  }

  // Create client with appropriate configuration for account type
  const clientOptions = {
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
  };

  // User accounts may need different configuration than bots
  if (accountConfig.accountType === 'user') {
    // User accounts don't need to specify any special token type
    // The authentication is handled through the login method
  }

  const client = new Client(clientOptions);

  // Set up event handlers
  client.once("ready", () => {
    console.log(`${accountConfig.accountType} [${accountConfig.id}] logged in as ${client.user?.tag}`);
  });

  // Handle incoming messages
  client.on("messageCreate", async (message: Message) => {
    // If the message is from the same account, skip (avoid self-mention loops)
    if (message.author.id === client.user?.id) {
      return;
    }

    if (!(await canRespondToChannel(message.channel))) return;

    // If this message is from a real user (not bot/account), reset chain tracking for this channel
    if (!message.author.bot && message.channel.type !== ChannelType.DM) {
      const channelId = message.channel.id;
      if (accountToAccountChains.has(channelId)) {
        accountToAccountChains.delete(channelId);
      }
    }

    // Handle DMs differently from server messages
    if (message.channel.type === ChannelType.DM) {
      await handleDirectMessage(message, accountConfig);
      return;
    }

    // Get the account's user information
    const accountUser = client.user;
    if (!accountUser) return; // Guard against undefined client.user

    const accountUsername = accountUser.username.toLowerCase();

    // Check if the message mentions or references the account
    const isMentioned = message.mentions.users.has(accountUser.id);
    const containsAccountName = message.content.toLowerCase().includes(accountUsername);

    // Use unified response logic for both bot and user accounts
    const shouldRespond = shouldAccountRespond(message, accountConfig, isMentioned, containsAccountName);

    // Ignore if the account should not respond
    if (!shouldRespond) return;

    // Check account chain limits before responding (we're not in DM since we handled that above)
    if (!shouldAllowAccountResponse(message.channel.id, accountConfig.id)) {
      // Chain limit exceeded, do not respond
      return;
    }

    let typingTimeout: NodeJS.Timeout | null = null;
    
    try {
      // Check for debug cheat codes
      const debugCheats = checkDebugCheats(message.content);
      
      // Calculate realistic response timing
      const interactionKey = getInteractionKey(message.channel.id, message.author.id, accountConfig.id);
      const lastInteractionTime = lastInteractionTimes.get(interactionKey);
      
      // If no previous interaction, treat as first-time interaction (short delay)
      const timeSinceLastMs = lastInteractionTime ? Date.now() - lastInteractionTime : 30000; // Default to 30 seconds for first interaction
      const isUrgent = isMessageUrgent(message.content, isMentioned);
      
      const responseDelayMs = debugCheats.instantResponse ? 1000 : calculateRealisticDelay(timeSinceLastMs, false, isUrgent);
      const typingDelayMs = debugCheats.instantResponse ? 200 : calculateTypingDelay(responseDelayMs);
      
      if (debugCheats.instantResponse) {
        console.log(`[${accountConfig.accountType} ${accountConfig.id}] Debug cheat activated - instant response (1s delay)`);
      } else {
        console.log(`[${accountConfig.accountType} ${accountConfig.id}] Realistic timing - delay: ${Math.round(responseDelayMs/1000)}s, typing in: ${Math.round(typingDelayMs/1000)}s (last interaction: ${Math.round(timeSinceLastMs/60000)}min ago)`);
      }
      
      // Emergency bypass for excessive delays (should not happen with new limits, but safety check)
      if (responseDelayMs > 30000) { // More than 30 seconds
        console.warn(`[${accountConfig.accountType} ${accountConfig.id}] Warning: Delay ${Math.round(responseDelayMs/1000)}s exceeds 30s, reducing to 10s for responsiveness`);
        const safeDelayMs = 10000; // 10 seconds
        const safeTypingDelayMs = calculateTypingDelay(safeDelayMs);
        
        // Use the safe delays instead
        await new Promise(resolve => setTimeout(resolve, safeTypingDelayMs));
        if (
          message.channel instanceof BaseGuildTextChannel ||
          message.channel instanceof DMChannel
        ) {
          await message.channel.sendTyping();
        }
        await new Promise(resolve => setTimeout(resolve, safeDelayMs - safeTypingDelayMs));
      } else {
        // Normal timing flow
        // Schedule typing indicator to show partway through delay
        typingTimeout = setTimeout(async () => {
          try {
            if (
              message.channel instanceof BaseGuildTextChannel ||
              message.channel instanceof DMChannel
            ) {
              await message.channel.sendTyping();
            }
          } catch (typingError) {
            // Silently handle typing errors (channel might be unavailable)
            console.warn(`[${accountConfig.accountType} ${accountConfig.id}] Typing indicator failed:`, typingError);
          }
        }, typingDelayMs);
        
        // Wait for the calculated response delay
        await new Promise(resolve => setTimeout(resolve, responseDelayMs));
      }
      
      // Clear the typing timeout (in case the delay was shorter than expected)
      if (typingTimeout) {
        clearTimeout(typingTimeout);
        typingTimeout = null;
      }
      
      // Fetch recent conversation with caching
      const conversationArray = await ephemeralFetchConversation(
        message.channel as TextChannel | DMChannel,
        DM_FETCH_LIMIT,
        CHANNEL_CACHE_DURATION_MS
      );

      // Call Kindroid AI with the conversation context
      const aiResult = await callKindroidAI(
        accountConfig.sharedAiCode,
        conversationArray,
        accountConfig.enableFilter
      );

      // If rate limited, silently ignore
      if (aiResult.type === "rate_limited") {
        return;
      }

      // Check if we should attach a Reddit image
      const shouldAttachImage = shouldAttachRedditImage(message.channel.id, accountConfig, debugCheats.forceImage);
      let imageAttachment: AttachmentBuilder | null = null;

      if (shouldAttachImage && accountConfig.redditConfig) {
        console.log(`[${accountConfig.accountType} ${accountConfig.id}] Fetching Reddit image...`);
        const redditImage = await getUnseenRandomRedditImage(accountConfig, message.channel.id);
        
        if (redditImage) {
          // Create an attachment from the image buffer
          imageAttachment = new AttachmentBuilder(redditImage.buffer, {
            name: redditImage.filename,
            description: `${redditImage.title} • r/${redditImage.subreddit}`,
          });
          console.log(`[${accountConfig.accountType} ${accountConfig.id}] Prepared image attachment: ${redditImage.filename}`);
        }
      }

      // Prepare the message options
      const messageOptions: MessageCreateOptions = {
        content: aiResult.reply,
      };

      if (imageAttachment) {
        messageOptions.files = [imageAttachment];
      }

      // If it was a mention, reply to the message. Otherwise, send as normal message
      if (isMentioned) {
        await message.reply(messageOptions);
      } else if (
        message.channel instanceof BaseGuildTextChannel ||
        message.channel instanceof DMChannel
      ) {
        await message.channel.send(messageOptions);
      }
      
      // Update last interaction time after successful response
      updateLastInteractionTime(message.channel.id, message.author.id, accountConfig.id);
    } catch (error) {
      console.error(`[${accountConfig.accountType} ${accountConfig.id}] Error:`, error);
      const errorMessage =
        "Beep boop, something went wrong. Please contact the Kindroid owner if this keeps up!";
      try {
        if (isMentioned) {
          await message.reply(errorMessage);
        } else if (
          message.channel instanceof BaseGuildTextChannel ||
          message.channel instanceof DMChannel
        ) {
          await message.channel.send(errorMessage);
        }
      } catch (replyError) {
        console.error(`[${accountConfig.accountType} ${accountConfig.id}] Failed to send error message:`, replyError);
      }
    } finally {
      // Always clear the typing timeout to prevent memory leaks
      if (typingTimeout) {
        clearTimeout(typingTimeout);
      }
    }
  });

  // Handle errors
  client.on("error", (error: Error) => {
    console.error(`[${accountConfig.accountType} ${accountConfig.id}] WebSocket error:`, error);
  });

  // Login with appropriate token based on account type
  try {
    const token = accountConfig.accountType === 'bot' 
      ? (accountConfig as BotConfig).discordBotToken 
      : (accountConfig as UserConfig).discordUserToken;
    
    await client.login(token);
    activeBots.set(accountConfig.id, client);
  } catch (error) {
    console.error(`Failed to login ${accountConfig.accountType} ${accountConfig.id}:`, error);
    throw error;
  }

  return client;
}

/**
 * Handle direct messages to the account
 * @param message - The Discord message
 * @param accountConfig - The account's configuration
 */
async function handleDirectMessage(
  message: Message,
  accountConfig: AccountConfig
): Promise<void> {
  const userId = message.author.id;
  const dmKey = `${accountConfig.id}-${userId}`;

  // Initialize or increment DM count
  const currentData = dmConversationCounts.get(dmKey) || {
    count: 0,
    lastMessageTime: 0,
  };
  const newCount = currentData.count + 1;
  const now = Date.now();

  dmConversationCounts.set(dmKey, {
    count: newCount,
    lastMessageTime: now,
  });

  // Clean up old DM conversation data periodically
  if (dmConversationCounts.size > 1000) {
    const oldestAllowed = now - 7 * 24 * 60 * 60 * 1000; // Keep data for 7 days
    for (const [key, value] of dmConversationCounts.entries()) {
      if (value.lastMessageTime < oldestAllowed) {
        dmConversationCounts.delete(key);
      }
    }
  }

  let typingTimeout: NodeJS.Timeout | null = null;
  
  try {
    // Check for debug cheat codes
    const debugCheats = checkDebugCheats(message.content);
    
    // Calculate realistic response timing for DM
    const interactionKey = getInteractionKey(message.channel.id, message.author.id, accountConfig.id);
    const lastInteractionTime = lastInteractionTimes.get(interactionKey);
    
    // If no previous interaction, treat as first-time interaction (short delay)
    const timeSinceLastMs = lastInteractionTime ? Date.now() - lastInteractionTime : 30000; // Default to 30 seconds for first interaction
    const isUrgent = isMessageUrgent(message.content, true); // DMs are generally urgent
    
    const responseDelayMs = debugCheats.instantResponse ? 1000 : calculateRealisticDelay(timeSinceLastMs, true, isUrgent);
    const typingDelayMs = debugCheats.instantResponse ? 200 : calculateTypingDelay(responseDelayMs);
    
    if (debugCheats.instantResponse) {
      console.log(`[${accountConfig.accountType} ${accountConfig.id}] Debug cheat activated - instant DM response (1s delay)`);
    } else {
      console.log(`[${accountConfig.accountType} ${accountConfig.id}] DM timing - delay: ${Math.round(responseDelayMs/1000)}s, typing in: ${Math.round(typingDelayMs/1000)}s (last interaction: ${Math.round(timeSinceLastMs/60000)}min ago)`);
    }
    
    // Emergency bypass for excessive delays (should not happen with new limits, but safety check)
    if (responseDelayMs > 30000) { // More than 30 seconds
      console.warn(`[${accountConfig.accountType} ${accountConfig.id}] Warning: DM delay ${Math.round(responseDelayMs/1000)}s exceeds 30s, reducing to 10s for responsiveness`);
      const safeDelayMs = 10000; // 10 seconds
      const safeTypingDelayMs = calculateTypingDelay(safeDelayMs);
      
      // Use the safe delays instead
      await new Promise(resolve => setTimeout(resolve, safeTypingDelayMs));
      if (message.channel instanceof DMChannel) {
        await message.channel.sendTyping();
      }
      await new Promise(resolve => setTimeout(resolve, safeDelayMs - safeTypingDelayMs));
    } else {
      // Normal timing flow
      // Schedule typing indicator to show partway through delay
      typingTimeout = setTimeout(async () => {
        try {
          if (message.channel instanceof DMChannel) {
            await message.channel.sendTyping();
          }
        } catch (typingError) {
          // Silently handle typing errors (channel might be unavailable)
          console.warn(`[${accountConfig.accountType} ${accountConfig.id}] DM typing indicator failed:`, typingError);
        }
      }, typingDelayMs);
      
      // Wait for the calculated response delay
      await new Promise(resolve => setTimeout(resolve, responseDelayMs));
    }
    
    // Clear the typing timeout (in case the delay was shorter than expected)
    if (typingTimeout) {
      clearTimeout(typingTimeout);
      typingTimeout = null;
    }

    if (message.channel instanceof DMChannel) {
      // Fetch recent conversation
      const conversationArray = await ephemeralFetchConversation(
        message.channel,
        DM_FETCH_LIMIT,
        CHANNEL_CACHE_DURATION_MS
      );

      // Call Kindroid AI
      const aiResult = await callKindroidAI(
        accountConfig.sharedAiCode,
        conversationArray,
        accountConfig.enableFilter
      );

      // If rate limited, silently ignore
      if (aiResult.type === "rate_limited") {
        return;
      }

      // Check if we should attach a Reddit image
      const shouldAttachImage = shouldAttachRedditImage(message.channel.id, accountConfig, debugCheats.forceImage);
      let imageAttachment: AttachmentBuilder | null = null;

      if (shouldAttachImage && accountConfig.redditConfig) {
        console.log(`[${accountConfig.accountType} ${accountConfig.id}] Fetching Reddit image for DM...`);
        const redditImage = await getUnseenRandomRedditImage(accountConfig, message.channel.id);
        
        if (redditImage) {
          // Create an attachment from the image buffer
          imageAttachment = new AttachmentBuilder(redditImage.buffer, {
            name: redditImage.filename,
            description: `${redditImage.title} • r/${redditImage.subreddit}`,
          });
          console.log(`[${accountConfig.accountType} ${accountConfig.id}] Prepared DM image attachment: ${redditImage.filename}`);
        }
      }

      // Prepare the message options
      const messageOptions: MessageCreateOptions = {
        content: aiResult.reply,
      };

      if (imageAttachment) {
        messageOptions.files = [imageAttachment];
      }

      // Send the AI's reply
      await message.reply(messageOptions);
      
      // Update last interaction time after successful DM response
      updateLastInteractionTime(message.channel.id, message.author.id, accountConfig.id);
    }
  } catch (error) {
    console.error(`[${accountConfig.accountType} ${accountConfig.id}] DM Error:`, error);
    try {
      await message.reply(
        "Beep boop, something went wrong. Please contact the Kindroid owner if this keeps up!"
      );
    } catch (replyError) {
      console.error(`[${accountConfig.accountType} ${accountConfig.id}] Failed to send DM error message:`, replyError);
    }
  } finally {
    // Always clear the typing timeout to prevent memory leaks
    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }
  }
}

/**
 * Initialize all accounts from their configurations
 * @param accountConfigs - Array of account configurations (bots and users)
 */
async function initializeAllBots(accountConfigs: AccountConfig[]): Promise<Client[]> {
  console.log(`Initializing ${accountConfigs.length} accounts...`);

  const initPromises = accountConfigs.map((config) =>
    createDiscordClient(config).catch((error) => {
      console.error(`Failed to initialize ${config.accountType} ${config.id}:`, error);
      return null;
    })
  );

  const results = await Promise.all(initPromises);
  const successfulAccounts = results.filter(
    (client): client is Client => client !== null
  );

  console.log(
    `Successfully initialized ${successfulAccounts.length} out of ${accountConfigs.length} accounts`
  );

  return successfulAccounts;
}

/**
 * Gracefully shutdown all active bots
 */
async function shutdownAllBots(): Promise<void> {
  console.log("Shutting down all bots...");

  const shutdownPromises = Array.from(activeBots.entries()).map(
    async ([id, client]) => {
      try {
        await client.destroy();
        console.log(`Bot ${id} shutdown successfully`);
      } catch (error) {
        console.error(`Error shutting down bot ${id}:`, error);
      }
    }
  );

  await Promise.all(shutdownPromises);
  activeBots.clear();
  dmConversationCounts.clear();
  channelMessageTrackers.clear();
  recentlySentRedditImagesByChannel.clear();
  accountToAccountChains.clear();
  lastInteractionTimes.clear();
}

export { initializeAllBots, shutdownAllBots };
