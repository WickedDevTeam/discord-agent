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
import { BotConfig, DMConversationCount, ChannelMessageTracker, RedditImageData } from "./types";
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

//Bot back and forth (prevent infinite loop but allow for mentioning other bots in conversation)
type BotConversationChain = {
  chainCount: number; // how many consecutive bot messages
  lastBotId: string; // ID of the last bot
  lastActivity: number; // timestamp of last message in chain
};

const botToBotChains = new Map<string, BotConversationChain>();

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

// Helper function to check if the bot can respond to a channel before responding
function shouldAllowBotMessage(message: Message): boolean {
  // If in DM, skip chain logic entirely
  if (message.channel.type === ChannelType.DM) {
    return false;
  }

  const channelId = message.channel.id;

  // Get (or initialize) the chain data for this channel
  const chainData = botToBotChains.get(channelId) || {
    chainCount: 0,
    lastBotId: "",
    lastActivity: 0,
  };

  const now = Date.now();
  const timeSinceLast = now - chainData.lastActivity;

  // If too much time passed, reset the chain
  if (timeSinceLast > BOT_CHAIN_INACTIVITY_RESET_MS) {
    chainData.chainCount = 0;
    chainData.lastBotId = "";
  }

  // If this message is from a *different* bot ID than before, increment chain
  if (chainData.lastBotId && chainData.lastBotId !== message.author.id) {
    chainData.chainCount++;
  }

  // Update tracking
  chainData.lastBotId = message.author.id;
  chainData.lastActivity = now;

  // Disallow if we've hit or exceeded the max chain limit
  if (chainData.chainCount >= MAX_BOT_CHAIN) {
    return false;
  }

  // Otherwise store updated data & allow
  botToBotChains.set(channelId, chainData);
  
  // Clean up old entries periodically to prevent unbounded growth
  if (botToBotChains.size > 1000) {
    const oldestAllowed = now - BOT_CHAIN_INACTIVITY_RESET_MS * 2; // Keep entries for 2x inactivity period
    for (const [key, value] of botToBotChains.entries()) {
      if (value.lastActivity < oldestAllowed) {
        botToBotChains.delete(key);
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
 * @param isMentioned - Whether bot was mentioned
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
 * @param botConfig - The bot configuration
 * @param forceImage - Debug cheat to force image attachment
 * @returns Whether to attach an image
 */
function shouldAttachRedditImage(
  channelId: string,
  botConfig: BotConfig,
  forceImage: boolean = false
): boolean {
  if (!botConfig.redditConfig || botConfig.redditConfig.subreddits.length === 0) {
    return false;
  }
  
  // Debug cheat: force image if double quotes detected
  if (forceImage) {
    console.log(`[Bot ${botConfig.id}] Debug cheat activated - forcing Reddit image attachment`);
    return true;
  }

  const now = Date.now();
  const tracker = channelMessageTrackers.get(channelId);
  if (!tracker) {
    // Initialize tracker for new channel
    const targetCount = Math.floor(
      Math.random() * (botConfig.redditConfig.maxMessages - botConfig.redditConfig.minMessages + 1) +
      botConfig.redditConfig.minMessages
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
      Math.random() * (botConfig.redditConfig.maxMessages - botConfig.redditConfig.minMessages + 1) +
      botConfig.redditConfig.minMessages
    );
    tracker.lastImageTime = now;
    return true;
  }

  return false;
}

/**
 * Fetches a random Reddit image that hasn't been recently sent in the channel.
 * @param botConfig Configuration for this bot instance
 * @param channelId The ID of the channel where the image will be sent
 * @returns An image data object or null if no suitable image is found.
 */
async function getUnseenRandomRedditImage(
  botConfig: BotConfig,
  channelId: string
): Promise<RedditImageData | null> {
  if (!botConfig.redditConfig || botConfig.redditConfig.subreddits.length === 0) {
    return null; // No Reddit config or no subreddits
  }

  const recentlySentIds = recentlySentRedditImagesByChannel.get(channelId) || [];

  for (let attempt = 0; attempt < MAX_UNIQUE_IMAGE_FETCH_ATTEMPTS; attempt++) {
    const image = await getRandomRedditImage(botConfig.redditConfig);

    if (!image) {
      // getRandomRedditImage itself failed to find anything (e.g., all subreddits failed)
      // No need to log here as getRandomRedditImage already logs its failures.
      if (attempt === 0) console.log(`[Bot ${botConfig.id}] Initial image fetch failed for channel ${channelId}.`);
      continue; // Try fetching again
    }

    if (!recentlySentIds.includes(image.id)) {
      // Found an image not in the recently sent list for this channel
      const updatedSentIds = [image.id, ...recentlySentIds].slice(0, RECENTLY_SENT_IMAGE_CACHE_SIZE);
      recentlySentRedditImagesByChannel.set(channelId, updatedSentIds);
      console.log(`[Bot ${botConfig.id}] Found new image ${image.id} for channel ${channelId}. Cache updated.`);
      return image;
    }

    console.log(`[Bot ${botConfig.id}] Image ${image.id} (r/${image.subreddit}) was recently sent in channel ${channelId}. Attempt ${attempt + 1}/${MAX_UNIQUE_IMAGE_FETCH_ATTEMPTS}.`);
  }

  // If all attempts result in recently sent images or failures, try one last time.
  // If this last one is still a repeat, send it anyway to prioritize sending *something*.
  // If this last fetch fails, then send nothing.
  console.log(`[Bot ${botConfig.id}] Could not find a unique image for channel ${channelId} after ${MAX_UNIQUE_IMAGE_FETCH_ATTEMPTS} attempts. Fetching one last time.`);
  const lastAttemptImage = await getRandomRedditImage(botConfig.redditConfig);

  if (lastAttemptImage) {
    const updatedSentIds = [lastAttemptImage.id, ...recentlySentIds].slice(0, RECENTLY_SENT_IMAGE_CACHE_SIZE);
    recentlySentRedditImagesByChannel.set(channelId, updatedSentIds);
    console.log(`[Bot ${botConfig.id}] Using last-attempt image ${lastAttemptImage.id} for channel ${channelId}. Cache updated.`);
    return lastAttemptImage;
  }
  
  console.log(`[Bot ${botConfig.id}] All attempts to fetch an image (unique or not) failed for channel ${channelId}. No image will be sent.`);
  return null;
}

/**
 * Creates and initializes a Discord client for a specific bot configuration
 * @param botConfig - Configuration for this bot instance
 */
async function createDiscordClientForBot(
  botConfig: BotConfig
): Promise<Client> {
  // Validate Reddit subreddits if configured
  if (botConfig.redditConfig && botConfig.redditConfig.subreddits.length > 0) {
    console.log(`[Bot ${botConfig.id}] Validating Reddit subreddits...`);
    const validSubreddits = await validateSubreddits(botConfig.redditConfig.subreddits);
    
    if (validSubreddits.length === 0) {
      console.warn(`[Bot ${botConfig.id}] No valid subreddits found. Reddit image feature disabled.`);
      botConfig.redditConfig.subreddits = [];
    } else {
      botConfig.redditConfig.subreddits = validSubreddits;
      console.log(`[Bot ${botConfig.id}] Valid subreddits: ${validSubreddits.join(", ")}`);
    }
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  // Set up event handlers
  client.once("ready", () => {
    console.log(`Bot [${botConfig.id}] logged in as ${client.user?.tag}`);
  });

  // Handle incoming messages
  client.on("messageCreate", async (message: Message) => {
    // If the message is from the same bot, skip (avoid self-mention loops)
    if (message.author.bot && message.author.id === client.user?.id) {
      return;
    }

    if (message.author.bot) {
      if (!shouldAllowBotMessage(message)) {
        // If chain limit exceeded, do not respond.
        return;
      }
    } else {
      const channelId = message.channel.id;
      if (botToBotChains.has(channelId)) {
        botToBotChains.delete(channelId);
      }
    }

    if (!(await canRespondToChannel(message.channel))) return;

    // Handle DMs differently from server messages
    if (message.channel.type === ChannelType.DM) {
      await handleDirectMessage(message, botConfig);
      return;
    }

    // Get the bot's user information
    const botUser = client.user;
    if (!botUser) return; // Guard against undefined client.user

    const botUsername = botUser.username.toLowerCase();

    // Check if the message mentions or references the bot
    const isMentioned = message.mentions.users.has(botUser.id);
    const containsBotName = message.content.toLowerCase().includes(botUsername);

    // Ignore if the bot is not mentioned or referenced
    if (!isMentioned && !containsBotName) return;

    let typingTimeout: NodeJS.Timeout | null = null;
    
    try {
      // Check for debug cheat codes
      const debugCheats = checkDebugCheats(message.content);
      
      // Calculate realistic response timing
      const interactionKey = getInteractionKey(message.channel.id, message.author.id, botConfig.id);
      const lastInteractionTime = lastInteractionTimes.get(interactionKey);
      
      // If no previous interaction, treat as first-time interaction (short delay)
      const timeSinceLastMs = lastInteractionTime ? Date.now() - lastInteractionTime : 30000; // Default to 30 seconds for first interaction
      const isUrgent = isMessageUrgent(message.content, isMentioned);
      
      const responseDelayMs = debugCheats.instantResponse ? 1000 : calculateRealisticDelay(timeSinceLastMs, false, isUrgent);
      const typingDelayMs = debugCheats.instantResponse ? 200 : calculateTypingDelay(responseDelayMs);
      
      if (debugCheats.instantResponse) {
        console.log(`[Bot ${botConfig.id}] Debug cheat activated - instant response (1s delay)`);
      } else {
        console.log(`[Bot ${botConfig.id}] Realistic timing - delay: ${Math.round(responseDelayMs/1000)}s, typing in: ${Math.round(typingDelayMs/1000)}s (last interaction: ${Math.round(timeSinceLastMs/60000)}min ago)`);
      }
      
      // Emergency bypass for excessive delays (should not happen with new limits, but safety check)
      if (responseDelayMs > 30000) { // More than 30 seconds
        console.warn(`[Bot ${botConfig.id}] Warning: Delay ${Math.round(responseDelayMs/1000)}s exceeds 30s, reducing to 10s for responsiveness`);
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
            console.warn(`[Bot ${botConfig.id}] Typing indicator failed:`, typingError);
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
        botConfig.sharedAiCode,
        conversationArray,
        botConfig.enableFilter
      );

      // If rate limited, silently ignore
      if (aiResult.type === "rate_limited") {
        return;
      }

      // Check if we should attach a Reddit image
      const shouldAttachImage = shouldAttachRedditImage(message.channel.id, botConfig, debugCheats.forceImage);
      let imageAttachment: AttachmentBuilder | null = null;

      if (shouldAttachImage && botConfig.redditConfig) {
        console.log(`[Bot ${botConfig.id}] Fetching Reddit image...`);
        const redditImage = await getUnseenRandomRedditImage(botConfig, message.channel.id);
        
        if (redditImage) {
          // Create an attachment from the image buffer
          imageAttachment = new AttachmentBuilder(redditImage.buffer, {
            name: redditImage.filename,
            description: `${redditImage.title} • r/${redditImage.subreddit}`,
          });
          console.log(`[Bot ${botConfig.id}] Prepared image attachment: ${redditImage.filename}`);
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
      updateLastInteractionTime(message.channel.id, message.author.id, botConfig.id);
    } catch (error) {
      console.error(`[Bot ${botConfig.id}] Error:`, error);
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
        console.error(`[Bot ${botConfig.id}] Failed to send error message:`, replyError);
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
    console.error(`[Bot ${botConfig.id}] WebSocket error:`, error);
  });

  // Login
  try {
    await client.login(botConfig.discordBotToken);
    activeBots.set(botConfig.id, client);
  } catch (error) {
    console.error(`Failed to login bot ${botConfig.id}:`, error);
    throw error;
  }

  return client;
}

/**
 * Handle direct messages to the bot
 * @param message - The Discord message
 * @param botConfig - The bot's configuration
 */
async function handleDirectMessage(
  message: Message,
  botConfig: BotConfig
): Promise<void> {
  const userId = message.author.id;
  const dmKey = `${botConfig.id}-${userId}`;

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
    const interactionKey = getInteractionKey(message.channel.id, message.author.id, botConfig.id);
    const lastInteractionTime = lastInteractionTimes.get(interactionKey);
    
    // If no previous interaction, treat as first-time interaction (short delay)
    const timeSinceLastMs = lastInteractionTime ? Date.now() - lastInteractionTime : 30000; // Default to 30 seconds for first interaction
    const isUrgent = isMessageUrgent(message.content, true); // DMs are generally urgent
    
    const responseDelayMs = debugCheats.instantResponse ? 1000 : calculateRealisticDelay(timeSinceLastMs, true, isUrgent);
    const typingDelayMs = debugCheats.instantResponse ? 200 : calculateTypingDelay(responseDelayMs);
    
    if (debugCheats.instantResponse) {
      console.log(`[Bot ${botConfig.id}] Debug cheat activated - instant DM response (1s delay)`);
    } else {
      console.log(`[Bot ${botConfig.id}] DM timing - delay: ${Math.round(responseDelayMs/1000)}s, typing in: ${Math.round(typingDelayMs/1000)}s (last interaction: ${Math.round(timeSinceLastMs/60000)}min ago)`);
    }
    
    // Emergency bypass for excessive delays (should not happen with new limits, but safety check)
    if (responseDelayMs > 30000) { // More than 30 seconds
      console.warn(`[Bot ${botConfig.id}] Warning: DM delay ${Math.round(responseDelayMs/1000)}s exceeds 30s, reducing to 10s for responsiveness`);
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
          console.warn(`[Bot ${botConfig.id}] DM typing indicator failed:`, typingError);
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
        botConfig.sharedAiCode,
        conversationArray,
        botConfig.enableFilter
      );

      // If rate limited, silently ignore
      if (aiResult.type === "rate_limited") {
        return;
      }

      // Check if we should attach a Reddit image
      const shouldAttachImage = shouldAttachRedditImage(message.channel.id, botConfig, debugCheats.forceImage);
      let imageAttachment: AttachmentBuilder | null = null;

      if (shouldAttachImage && botConfig.redditConfig) {
        console.log(`[Bot ${botConfig.id}] Fetching Reddit image for DM...`);
        const redditImage = await getUnseenRandomRedditImage(botConfig, message.channel.id);
        
        if (redditImage) {
          // Create an attachment from the image buffer
          imageAttachment = new AttachmentBuilder(redditImage.buffer, {
            name: redditImage.filename,
            description: `${redditImage.title} • r/${redditImage.subreddit}`,
          });
          console.log(`[Bot ${botConfig.id}] Prepared DM image attachment: ${redditImage.filename}`);
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
      updateLastInteractionTime(message.channel.id, message.author.id, botConfig.id);
    }
  } catch (error) {
    console.error(`[Bot ${botConfig.id}] DM Error:`, error);
    try {
      await message.reply(
        "Beep boop, something went wrong. Please contact the Kindroid owner if this keeps up!"
      );
    } catch (replyError) {
      console.error(`[Bot ${botConfig.id}] Failed to send DM error message:`, replyError);
    }
  } finally {
    // Always clear the typing timeout to prevent memory leaks
    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }
  }
}

/**
 * Initialize all bots from their configurations
 * @param botConfigs - Array of bot configurations
 */
async function initializeAllBots(botConfigs: BotConfig[]): Promise<Client[]> {
  console.log(`Initializing ${botConfigs.length} bots...`);

  const initPromises = botConfigs.map((config) =>
    createDiscordClientForBot(config).catch((error) => {
      console.error(`Failed to initialize bot ${config.id}:`, error);
      return null;
    })
  );

  const results = await Promise.all(initPromises);
  const successfulBots = results.filter(
    (client): client is Client => client !== null
  );

  console.log(
    `Successfully initialized ${successfulBots.length} out of ${botConfigs.length} bots`
  );

  return successfulBots;
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
  botToBotChains.clear();
  lastInteractionTimes.clear();
}

export { initializeAllBots, shutdownAllBots };
