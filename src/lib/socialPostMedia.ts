export function getPostImageUrls(raw: string | null | undefined): string[] {
  const value = String(raw ?? "").trim();
  if (!value) return [];

  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => String(item ?? "").trim())
          .filter(Boolean);
      }
    } catch {
      // Fall back to delimiter-based parsing below.
    }
  }

  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function serializePostMediaUrls(urls: string[]): string | null {
  const normalized = Array.from(
    new Set(
      urls
        .map((url) => String(url ?? "").trim())
        .filter(Boolean),
    ),
  );

  if (normalized.length === 0) {
    return null;
  }

  return normalized.length === 1 ? normalized[0] : JSON.stringify(normalized);
}

export function isVideoMediaUrl(url: string | null | undefined): boolean {
  const value = String(url ?? "").trim().toLowerCase();
  if (!value) return false;

  try {
    const pathname = new URL(value).pathname.toLowerCase();
    return /\.(mp4|mov|webm|m4v|avi|mkv|mpeg|mpg|ogv)$/i.test(pathname);
  } catch {
    return /\.(mp4|mov|webm|m4v|avi|mkv|mpeg|mpg|ogv)$/i.test(value);
  }
}
