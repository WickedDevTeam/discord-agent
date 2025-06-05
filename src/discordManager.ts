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
  EmbedBuilder,
  MessageCreateOptions,
} from "discord.js";
import { ephemeralFetchConversation } from "./messageFetch";
import { callKindroidAI } from "./kindroidAPI";
import { BotConfig, DMConversationCount, ChannelMessageTracker } from "./types";
import { getRandomRedditImage, validateSubreddits } from "./redditAPI";
import {
  DISCORD_EMBED_TITLE_MAX_LENGTH,
  DISCORD_EMBED_COLOR_REDDIT,
  CHANNEL_CACHE_DURATION_MS,
  DM_FETCH_LIMIT,
  MAX_BOT_CHAIN,
  BOT_CHAIN_INACTIVITY_RESET_MS,
  RECENTLY_SENT_IMAGE_CACHE_SIZE,
  MAX_UNIQUE_IMAGE_FETCH_ATTEMPTS,
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
 * Checks if a Reddit image should be attached based on message count
 * @param channelId - The channel ID
 * @param botConfig - The bot configuration
 * @returns Whether to attach an image
 */
function shouldAttachRedditImage(
  channelId: string,
  botConfig: BotConfig
): boolean {
  if (!botConfig.redditConfig || botConfig.redditConfig.subreddits.length === 0) {
    return false;
  }

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
    tracker.lastImageTime = Date.now();
    return true;
  }

  return false;
}

/**
 * Fetches a random Reddit image that hasn't been recently sent in the channel.
 * @param botConfig Configuration for this bot instance
 * @param channelId The ID of the channel where the image will be sent
 * @returns An image object or null if no suitable image is found.
 */
async function getUnseenRandomRedditImage(
  botConfig: BotConfig,
  channelId: string
): Promise<{ id: string; url: string; title: string; subreddit: string } | null> {
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

    try {
      // Show typing indicator
      if (
        message.channel instanceof BaseGuildTextChannel ||
        message.channel instanceof DMChannel
      ) {
        await message.channel.sendTyping();
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
      const shouldAttachImage = shouldAttachRedditImage(message.channel.id, botConfig);
      let imageEmbed: EmbedBuilder | null = null;

      if (shouldAttachImage && botConfig.redditConfig) {
        console.log(`[Bot ${botConfig.id}] Fetching Reddit image...`);
        const redditImage = await getUnseenRandomRedditImage(botConfig, message.channel.id);
        
        if (redditImage) {
          // Create an embed with the image
          imageEmbed = new EmbedBuilder()
            .setTitle(redditImage.title.length > DISCORD_EMBED_TITLE_MAX_LENGTH ? 
              redditImage.title.substring(0, DISCORD_EMBED_TITLE_MAX_LENGTH - 3) + "..." : 
              redditImage.title)
            .setImage(redditImage.url)
            .setFooter({ text: `r/${redditImage.subreddit}` })
            .setColor(DISCORD_EMBED_COLOR_REDDIT);
        }
      }

      // Prepare the message options
      const messageOptions: MessageCreateOptions = {
        content: aiResult.reply,
      };

      if (imageEmbed) {
        messageOptions.embeds = [imageEmbed];
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
    } catch (error) {
      console.error(`[Bot ${botConfig.id}] Error:`, error);
      const errorMessage =
        "Beep boop, something went wrong. Please contact the Kindroid owner if this keeps up!";
      if (isMentioned) {
        await message.reply(errorMessage);
      } else if (
        message.channel instanceof BaseGuildTextChannel ||
        message.channel instanceof DMChannel
      ) {
        await message.channel.send(errorMessage);
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

  dmConversationCounts.set(dmKey, {
    count: newCount,
    lastMessageTime: Date.now(),
  });

  try {
    // Show typing indicator
    if (message.channel instanceof DMChannel) {
      await message.channel.sendTyping();

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
      const shouldAttachImage = shouldAttachRedditImage(message.channel.id, botConfig);
      let imageEmbed: EmbedBuilder | null = null;

      if (shouldAttachImage && botConfig.redditConfig) {
        console.log(`[Bot ${botConfig.id}] Fetching Reddit image for DM...`);
        const redditImage = await getUnseenRandomRedditImage(botConfig, message.channel.id);
        
        if (redditImage) {
          // Create an embed with the image
          imageEmbed = new EmbedBuilder()
            .setTitle(redditImage.title.length > DISCORD_EMBED_TITLE_MAX_LENGTH ? 
              redditImage.title.substring(0, DISCORD_EMBED_TITLE_MAX_LENGTH - 3) + "..." : 
              redditImage.title)
            .setImage(redditImage.url)
            .setFooter({ text: `r/${redditImage.subreddit}` })
            .setColor(DISCORD_EMBED_COLOR_REDDIT);
        }
      }

      // Prepare the message options
      const messageOptions: MessageCreateOptions = {
        content: aiResult.reply,
      };

      if (imageEmbed) {
        messageOptions.embeds = [imageEmbed];
      }

      // Send the AI's reply
      await message.reply(messageOptions);
    }
  } catch (error) {
    console.error(`[Bot ${botConfig.id}] DM Error:`, error);
    await message.reply(
      "Beep boop, something went wrong. Please contact the Kindroid owner if this keeps up!"
    );
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
}

export { initializeAllBots, shutdownAllBots };
