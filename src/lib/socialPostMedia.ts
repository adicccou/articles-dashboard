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
