import axios, { AxiosError } from "axios";
import { RedditListing, RedditPost, RedditImageConfig, RedditImageData } from "./types";
import { 
  REDDIT_USER_AGENT, 
  REDDIT_API_RATE_LIMIT_MS, 
  REDDIT_FETCH_LIMIT,
  REDDIT_MAX_RETRIES,
  REDDIT_RETRY_DELAY_MS,
  IMAGE_EXTENSIONS,
  DISCORD_MAX_FILE_SIZE,
  REDDIT_IMAGE_DOWNLOAD_TIMEOUT_MS
} from "./constants";

// Rate limiting: track last request time
let lastRedditRequestTime = 0;

/**
 * Enforces rate limiting for Reddit API calls
 */
async function enforceRateLimit(): Promise<void> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRedditRequestTime;
  
  if (timeSinceLastRequest < REDDIT_API_RATE_LIMIT_MS) {
    const waitTime = REDDIT_API_RATE_LIMIT_MS - timeSinceLastRequest;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  lastRedditRequestTime = Date.now();
}

/**
 * Retries an async function with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = REDDIT_MAX_RETRIES
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      // Don't retry on 404s
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw error;
      }
      
      // Wait before retrying (exponential backoff)
      const waitTime = REDDIT_RETRY_DELAY_MS * Math.pow(2, attempt);
      console.warn(`Reddit API request failed, retrying in ${waitTime}ms... (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  throw lastError;
}

/**
 * Fetches image posts from a specific subreddit
 * @param subreddit - The subreddit name (without r/)
 * @param limit - Number of posts to fetch
 * @param sortBy - Sort method (hot, new, top)
 * @returns Array of Reddit posts that contain images
 */
async function fetchSubredditImages(
  subreddit: string,
  limit: number = REDDIT_FETCH_LIMIT,
  sortBy: "hot" | "new" | "top" = "hot"
): Promise<RedditPost[]> {
  await enforceRateLimit();
  
  return retryWithBackoff(async () => {
    try {
      const requestParams: { limit: number; raw_json: number; t?: string } = {
        limit: Math.min(limit, 100), // Reddit's max is 100
        raw_json: 1, // Prevents Reddit from HTML-encoding URLs
      };

      if (sortBy === "top") {
        const timeWindows: Array<"hour" | "day" | "week" | "month" | "year" | "all"> = [
          "hour", "day", "week", "month", "year", "all"
        ];
        requestParams.t = timeWindows[Math.floor(Math.random() * timeWindows.length)];
        // Optionally log the chosen time window for debugging
        // console.log(`[RedditAPI] Using sortBy 'top' with time window '${requestParams.t}' for r/${subreddit}`);
      }

      const response = await axios.get<RedditListing>(
        `https://www.reddit.com/r/${subreddit}/${sortBy}.json`,
        {
          params: requestParams,
          headers: {
            "User-Agent": REDDIT_USER_AGENT,
          },
          timeout: 10000, // 10 second timeout
        }
      );

      // Validate response structure
      if (!response.data?.data?.children || !Array.isArray(response.data.data.children)) {
        throw new Error("Invalid Reddit API response structure");
      }

      // Filter for image posts
      const imagePosts = response.data.data.children.filter((post: RedditPost) => {
        const { data } = post;
        
        // Skip if no data
        if (!data || !data.url) return false;
        
        // Skip videos
        if (data.is_video) return false;
        
        // Skip removed/deleted posts
        if (data.removed || data.selftext === "[removed]" || data.selftext === "[deleted]") return false;
        
        // Check if URL is an image
        const hasImageExtension = IMAGE_EXTENSIONS.some((ext) =>
          data.url.toLowerCase().endsWith(ext)
        );
        
        // Check post hint
        const isImageHint = data.post_hint === "image";
        
        // Check if it has preview images
        const hasPreview = data.preview && data.preview.images && data.preview.images.length > 0;
        
        return hasImageExtension || isImageHint || hasPreview;
      });

      return imagePosts;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status === 404) {
          console.error(`Subreddit r/${subreddit} not found`);
        } else if (axiosError.response?.status === 403) {
          console.error(`Access forbidden to r/${subreddit} (might be private)`);
        } else if (axiosError.response?.status === 429) {
          console.error(`Rate limited by Reddit API`);
        }
      }
      console.error(`Error fetching images from r/${subreddit}:`, error);
      throw new Error(`Failed to fetch images from r/${subreddit}`);
    }
  });
}

/**
 * Decodes HTML entities from a string
 * @param encodedString The string to decode
 * @returns The decoded string
 */
function decodeHtmlEntities(encodedString: string): string {
  return encodedString
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'") // Common alternative for apostrophe
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

/**
 * Gets a direct image URL from a Reddit post
 * @param post - The Reddit post
 * @returns Direct image URL or null if not found
 */
function getImageUrlFromPost(post: RedditPost): string | null {
  const { data } = post;
  
  if (!data || !data.url) return null;
  
  try {
    const decodedPostUrl = decodeHtmlEntities(data.url);

    // First, check if the URL is already a direct image link
    if (IMAGE_EXTENSIONS.some((ext) => decodedPostUrl.toLowerCase().endsWith(ext))) {
      return decodedPostUrl;
    }
    
    // Try to get from preview (source or a high-quality resolution)
    if (data.preview && data.preview.images && data.preview.images.length > 0) {
      const mainPreviewImage = data.preview.images[0];
      
      // Prefer a high-resolution image from the resolutions array if available
      // Let's target resolutions around 640-1080px wide as a good balance
      if (mainPreviewImage.resolutions && mainPreviewImage.resolutions.length > 0) {
        const suitableResolutions = mainPreviewImage.resolutions.filter(
          res => res.width >= 600 && res.width <= 1280
        );
        if (suitableResolutions.length > 0) {
          // Pick the largest suitable resolution
          const bestFitResolution = suitableResolutions.sort((a, b) => b.width - a.width)[0];
          return decodeHtmlEntities(bestFitResolution.url);
        }
      }
      
      // Fallback to the source image if no suitable resolution found or resolutions array is empty
      if (mainPreviewImage.source && mainPreviewImage.source.url) {
        return decodeHtmlEntities(mainPreviewImage.source.url);
      }
    }
    
    // Handle imgur links (ensure URL is decoded before processing)
    if (decodedPostUrl.includes("imgur.com")) {
      // Skip imgur albums
      if (decodedPostUrl.includes("/a/") || decodedPostUrl.includes("/gallery/")) {
        return null;
      }
      
      // Convert imgur page URLs to direct image URLs
      const imgurMatch = decodedPostUrl.match(/imgur\.com\/([a-zA-Z0-9]+)/);
      if (imgurMatch && imgurMatch[1]) {
        return `https://i.imgur.com/${imgurMatch[1]}.jpg`;
      }
    }
    
    // Handle i.redd.it links (already direct links, but ensure decoded)
    if (decodedPostUrl.includes("i.redd.it")) {
      return decodedPostUrl;
    }
    
    // Handle Reddit gallery posts
    if (decodedPostUrl.includes("reddit.com/gallery/")) {
      return null; // Galleries not supported for now
    }
    
    return null;
  } catch (error) {
    console.error("Error extracting image URL:", error);
    return null;
  }
}

/**
 * Downloads an image from a URL and returns it as a buffer
 * @param url - The image URL to download
 * @param postId - The Reddit post ID for logging
 * @returns Buffer containing the image data, or null if download fails
 */
async function downloadImage(url: string, postId: string): Promise<Buffer | null> {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: REDDIT_IMAGE_DOWNLOAD_TIMEOUT_MS,
      headers: {
        'User-Agent': REDDIT_USER_AGENT,
      },
      maxContentLength: DISCORD_MAX_FILE_SIZE,
      maxBodyLength: DISCORD_MAX_FILE_SIZE,
    });

    // Check content type to ensure it's an image
    const contentType = response.headers['content-type'];
    if (!contentType || !contentType.startsWith('image/')) {
      console.warn(`Non-image content type for post ${postId}: ${contentType}`);
      return null;
    }

    // Check file size
    const buffer = Buffer.from(response.data);
    if (buffer.length > DISCORD_MAX_FILE_SIZE) {
      console.warn(`Image from post ${postId} exceeds Discord file size limit: ${buffer.length} bytes`);
      return null;
    }

    return buffer;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        console.error(`Image download timeout for post ${postId}`);
      } else if (error.response) {
        console.error(`Image download failed for post ${postId}: ${error.response.status}`);
      } else {
        console.error(`Image download error for post ${postId}:`, error.message);
      }
    } else {
      console.error(`Unexpected error downloading image for post ${postId}:`, error);
    }
    return null;
  }
}

/**
 * Gets the file extension from a URL or content type
 * @param url - The image URL
 * @param contentType - Optional content type header
 * @returns File extension with dot (e.g., '.jpg')
 */
function getImageExtension(url: string, contentType?: string): string {
  // Try to get extension from URL first
  const urlLower = url.toLowerCase();
  for (const ext of IMAGE_EXTENSIONS) {
    if (urlLower.includes(ext)) {
      return ext;
    }
  }

  // Fallback to content type
  if (contentType) {
    const typeMap: { [key: string]: string } = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
    };
    const cleanType = contentType.split(';')[0].trim().toLowerCase();
    return typeMap[cleanType] || '.jpg';
  }

  // Default to .jpg
  return '.jpg';
}

/**
 * Fetches a random image from the configured subreddits
 * @param config - Reddit image configuration
 * @returns Object with image data and metadata, or null if no images found
 */
export async function getRandomRedditImage(
  config: RedditImageConfig
): Promise<RedditImageData | null> {
  if (!config.subreddits || config.subreddits.length === 0) {
    console.warn("No subreddits configured for Reddit images");
    return null;
  }
  
  // Try up to 3 different subreddits if one fails
  const maxSubredditAttempts = Math.min(3, config.subreddits.length);
  const triedSubreddits = new Set<string>();
  
  for (let attempt = 0; attempt < maxSubredditAttempts; attempt++) {
    try {
      // Select a random subreddit that we haven't tried yet
      const availableSubreddits = config.subreddits.filter(s => !triedSubreddits.has(s));
      if (availableSubreddits.length === 0) break;
      
      const randomSubreddit =
        availableSubreddits[Math.floor(Math.random() * availableSubreddits.length)];
      triedSubreddits.add(randomSubreddit);
      
      // Randomly select sort method
      const sortMethods: Array<"hot" | "new" | "top"> = ["hot", "new", "top"];
      const sortBy = sortMethods[Math.floor(Math.random() * sortMethods.length)];
      
      // Fetch images from the subreddit
      const posts = await fetchSubredditImages(randomSubreddit, REDDIT_FETCH_LIMIT, sortBy);
      
      if (posts.length === 0) {
        console.log(`No images found in r/${randomSubreddit}, trying another subreddit...`);
        continue;
      }
      
      // Filter out NSFW posts if configured
      const filteredPosts = config.nsfw
        ? posts
        : posts.filter((post) => !post.data.over_18);
      
      if (filteredPosts.length === 0) {
        console.log(`No suitable images found in r/${randomSubreddit} after filtering, trying another subreddit...`);
        continue;
      }
      
      // Try to find a valid image from the posts
      const shuffledPosts = [...filteredPosts].sort(() => Math.random() - 0.5);
      
      for (const post of shuffledPosts.slice(0, 10)) { // Try up to 10 posts
        const imageUrl = getImageUrlFromPost(post);
        
        if (imageUrl) {
          // Download the image
          const buffer = await downloadImage(imageUrl, post.data.id);
          
          if (buffer) {
            // Generate filename with subreddit and post ID
            const extension = getImageExtension(imageUrl);
            const filename = `r-${randomSubreddit}_${post.data.id}${extension}`;
            
            return {
              id: post.data.id,
              buffer,
              filename,
              title: post.data.title,
              subreddit: randomSubreddit,
            };
          } else {
            console.log(`Failed to download image for post ${post.data.id}, trying next...`);
          }
        }
      }
      
      console.log(`Could not extract valid image URLs from r/${randomSubreddit}, trying another subreddit...`);
    } catch (error) {
      console.error(`Error getting image from subreddit:`, error);
      // Continue to next subreddit
    }
  }
  
  console.warn("Failed to get Reddit image after multiple attempts");
  return null;
}

/**
 * Validates if the configured subreddits exist
 * @param subreddits - Array of subreddit names
 * @returns Array of valid subreddit names
 */
export async function validateSubreddits(
  subreddits: string[]
): Promise<string[]> {
  const validSubreddits: string[] = [];
  
  for (const subreddit of subreddits) {
    await enforceRateLimit();
    
    try {
      const response = await axios.get(
        `https://www.reddit.com/r/${subreddit}/about.json`,
        {
          headers: {
            "User-Agent": REDDIT_USER_AGENT,
          },
          timeout: 5000,
        }
      );
      
      if (response.data?.data?.display_name) {
        validSubreddits.push(subreddit);
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        console.warn(`Subreddit r/${subreddit} not found`);
      } else {
        console.warn(`Subreddit r/${subreddit} validation failed:`, error);
      }
    }
  }
  
  return validSubreddits;
} 