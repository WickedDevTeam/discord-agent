export interface BotConfig {
  id: string;
  discordBotToken: string;
  sharedAiCode: string;
  enableFilter: boolean;
  redditConfig?: RedditImageConfig;
}

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
