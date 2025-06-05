// Discord related constants
export const DISCORD_EMBED_TITLE_MAX_LENGTH = 256;
export const DISCORD_EMBED_COLOR_REDDIT = 0xff4500; // Reddit orange

// Reddit API constants
export const REDDIT_USER_AGENT = "Discord-Bot:Kindroid-Discord:v1.0.1";
export const REDDIT_API_RATE_LIMIT_MS = 1000; // 1 second between requests
export const REDDIT_FETCH_LIMIT = 50;
export const REDDIT_MAX_RETRIES = 3;
export const REDDIT_RETRY_DELAY_MS = 2000;

// Supported image extensions
export const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

// Message tracking constants
export const CHANNEL_CACHE_DURATION_MS = 5000; // 5 seconds
export const DM_FETCH_LIMIT = 30;

// Bot chain limits
export const MAX_BOT_CHAIN = 3;
export const BOT_CHAIN_INACTIVITY_RESET_MS = 600_000; // 10 minutes

// Reddit Image Cache
export const RECENTLY_SENT_IMAGE_CACHE_SIZE = 30; // Remember the last 30 image IDs per channel
export const MAX_UNIQUE_IMAGE_FETCH_ATTEMPTS = 5; // Max attempts to find a new (non-cached) image

// Discord file upload limits
export const DISCORD_MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB for normal servers
export const REDDIT_IMAGE_DOWNLOAD_TIMEOUT_MS = 10000; // 10 seconds timeout for downloading images

// Response timing constants
export const INTERACTION_TRACKING_CLEANUP_THRESHOLD = 1000; // Clean up when map exceeds this size
export const INTERACTION_TRACKING_RETENTION_MS = 24 * 60 * 60 * 1000; // Keep data for 24 hours
export const MAX_RESPONSE_DELAY_MS = 15 * 60 * 1000; // Cap delays at 15 minutes
export const MIN_RESPONSE_DELAY_MS = 2000; // Minimum 2 second delay
export const TYPING_INDICATOR_MIN_PERCENTAGE = 0.2; // Show typing at least 20% through delay
export const TYPING_INDICATOR_MAX_PERCENTAGE = 0.6; // Show typing at most 60% through delay