ALTER TABLE social_posts ADD COLUMN title TEXT;
ALTER TABLE social_posts ADD COLUMN subreddit TEXT;
ALTER TABLE social_posts ADD COLUMN account_id INTEGER REFERENCES reddit_accounts(id) ON DELETE SET NULL;
