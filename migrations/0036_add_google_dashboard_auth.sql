ALTER TABLE dashboard_users ADD COLUMN google_sub TEXT;
ALTER TABLE dashboard_users ADD COLUMN google_email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dashboard_users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'password';

CREATE UNIQUE INDEX IF NOT EXISTS ux_dashboard_users_google_sub
  ON dashboard_users(google_sub)
  WHERE google_sub IS NOT NULL AND google_sub != '';

UPDATE dashboard_users
SET email = NULL
WHERE id != 1 AND LOWER(email) = LOWER('adiccou@gmail.com');

UPDATE dashboard_users
SET username = 'user-' || id
WHERE id != 1 AND LOWER(username) = LOWER('adiccou@gmail.com');

UPDATE dashboard_users
SET
  username = 'adiccou@gmail.com',
  email = 'adiccou@gmail.com',
  display_name = CASE
    WHEN display_name IS NULL OR display_name = '' OR LOWER(display_name) = 'admin' THEN 'Adilet Melis'
    ELSE display_name
  END,
  role = 'owner',
  status = 'active',
  updated_at = datetime('now')
WHERE id = 1;

UPDATE workspaces
SET owner_user_id = 1, updated_at = datetime('now')
WHERE id = 1;

INSERT OR IGNORE INTO workspace_members (
  workspace_id,
  user_id,
  role,
  status,
  created_at,
  updated_at
)
VALUES (
  1,
  1,
  'owner',
  'active',
  datetime('now'),
  datetime('now')
);
