import type { StudioApp } from "./types";

export const STUDIO_APP_CONNECTION_REQUIREMENT = "website URL, app store URL, or articles API URL";

export function hasStudioAppConnection(
  app: Pick<StudioApp, "website_url" | "app_store_url" | "articles_api_url">,
) {
  return [app.website_url, app.app_store_url, app.articles_api_url].some((value) => String(value ?? "").trim().length > 0);
}
