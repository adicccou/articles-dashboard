export type PlaywrightAccountNamespace = "social_account" | "reddit_account";
export type PlaywrightAccountField = "login" | "password" | "profile_key";

export function playwrightUserSettingKey(
  namespace: PlaywrightAccountNamespace,
  accountId: number,
  dashboardUserId: number,
  field: PlaywrightAccountField,
): string {
  return `${namespace}:${accountId}:playwright_user:${dashboardUserId}:${field}`;
}

export function defaultPlaywrightProfileKey(
  platform: string,
  accountId: number,
  dashboardUserId: number,
): string {
  const normalizedPlatform = String(platform || "social").trim().toLowerCase() || "social";
  return `pw-${normalizedPlatform}-account-${accountId}-user-${dashboardUserId}`;
}
