export interface RedditSearchCriteria {
  min_score?: number;
  max_score?: number;
  time_filter?: "hour" | "day" | "week" | "month" | "year" | "all";
}

export interface RedditComment {
  id: string;
  author: string;
  content: string;
  score: number;
  created_utc: number;
  permalink: string;
  post_id: string;
}

export interface RedditClient {
  getComments(
    subreddit: string,
    query: string,
    criteria: RedditSearchCriteria,
  ): Promise<RedditComment[]>;

  postReply(
    commentId: string,
    content: string,
    accessToken: string,
  ): Promise<{ success: boolean; replyId?: string }>;

  validateAccessToken(accessToken: string): Promise<{ valid: boolean; username?: string }>;
}

export function createRedditClient(): RedditClient {
  return {
    async getComments(subreddit, query, criteria) {
      try {
        // Use pushshift/reddit API to search comments
        const timeFilter = criteria.time_filter || "week";
        const sort = "score";
        const size = 100;

        // Search via Reddit API
        const searchUrl = new URL("https://oauth.reddit.com/r/subreddit/comments/search");
        searchUrl.searchParams.set("q", query);
        searchUrl.searchParams.set("t", timeFilter);
        searchUrl.searchParams.set("sort", sort);
        searchUrl.searchParams.set("limit", "100");

        // Note: This requires a valid Reddit OAuth token passed from the campaign
        // For now, this is a placeholder that shows the structure
        console.log("Would search Reddit for:", {
          subreddit,
          query,
          criteria,
        });

        return [];
      } catch (error) {
        console.error("Error searching Reddit comments:", error);
        return [];
      }
    },

    async postReply(commentId, content, accessToken) {
      try {
        const response = await fetch("https://oauth.reddit.com/api/comment", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "BlogPoster/1.0",
          },
          body: new URLSearchParams({
            api_type: "json",
            text: content,
            thing_id: commentId,
          }).toString(),
        });

        if (!response.ok) {
          const error = await response.text();
          console.error("Reddit reply failed:", error);
          return { success: false };
        }

        const data = (await response.json()) as {
          json?: { data?: { things?: Array<{ data?: { name: string } }> } };
        };
        const replyId = data.json?.data?.things?.[0]?.data?.name;

        return { success: true, replyId };
      } catch (error) {
        console.error("Error posting reply to Reddit:", error);
        return { success: false };
      }
    },

    async validateAccessToken(accessToken) {
      try {
        const response = await fetch("https://oauth.reddit.com/api/v1/me", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "User-Agent": "BlogPoster/1.0",
          },
        });

        if (response.ok) {
          const data = (await response.json()) as { name: string };
          return { valid: true, username: data.name };
        }

        return { valid: false };
      } catch (error) {
        console.error("Error validating Reddit token:", error);
        return { valid: false };
      }
    },
  };
}
