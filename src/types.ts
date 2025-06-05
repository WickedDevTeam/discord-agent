export type AccountType = 'bot' | 'user';

export interface BaseAccountConfig {
  id: string;
  accountType: AccountType;
  token: string;
  sharedAiCode: string;
  enableFilter: boolean;
  redditConfig?: RedditImageConfig;
  interactionRate?: number; // 1-100: How likely to respond autonomously to conversations
}

export interface BotConfig extends BaseAccountConfig {
  accountType: 'bot';
  discordBotToken: string; // Keep for backward compatibility
}

export interface UserConfig extends BaseAccountConfig {
  accountType: 'user';
  discordUserToken: string;
  messageFrequency?: 'high' | 'medium' | 'low'; // Legacy - use interactionRate instead
  messageBehavior?: 'normal' | 'aggressive' | 'passive'; // Legacy - use interactionRate instead
}

export type AccountConfig = BotConfig | UserConfig;

export interface ConversationMessage {
  username: string;
  text: string;
  timestamp?: string;
}

export interface KindroidResponse {
  success: boolean;
  reply: string;
  stop_reason?: string | null;
  error?: string;
}

export interface DMConversationCount {
  count: number;
  lastMessageTime: number;
}

export type KindroidAIResult =
  | {
      type: "success";
      reply: string;
    }
  | {
      type: "rate_limited";
    };

// Reddit API types
export interface RedditPost {
  data: {
    id: string;
    title: string;
    url: string;
    post_hint?: string;
    is_video: boolean;
    over_18: boolean;
    removed?: boolean;
    selftext?: string;
    preview?: {
      images: Array<{
        source: {
          url: string;
          width: number;
          height: number;
        };
        resolutions: Array<{
          url: string;
          width: number;
          height: number;
        }>;
      }>;
    };
  };
}

export interface RedditListing {
  data: {
    children: RedditPost[];
    after: string | null;
    before: string | null;
  };
}

export interface RedditImageConfig {
  subreddits: string[];
  minMessages: number;
  maxMessages: number;
  nsfw: boolean;
}

export interface ChannelMessageTracker {
  messageCount: number;
  targetMessageCount: number;
  lastImageTime: number;
}

export interface RedditImageData {
  id: string;
  buffer: Buffer;
  filename: string;
  title: string;
  subreddit: string;
}
