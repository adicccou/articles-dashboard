type SiteBrandGuide = {
  slug: string;
  aliases: string[];
  brandName: string;
  visualDirection: string[];
  palette: string[];
  imagery: string[];
  composition: string[];
  avoid: string[];
};

const SITE_BRAND_GUIDES: SiteBrandGuide[] = [
  {
    slug: "journl",
    aliases: ["journl", "journl.day"],
    brandName: "journl",
    visualDirection: [
      "calm, focused, editorial trading-journal aesthetic",
      "premium but restrained, with lots of breathing room",
      "clean product-minded visuals rather than generic finance stock art",
    ],
    palette: [
      "soft off-white and warm paper-like neutrals",
      "charcoal or near-black for structure and contrast",
      "muted sage or emerald accents only in small doses",
    ],
    imagery: [
      "trading review sessions, reflective desk setups, notebooks, calm charts, disciplined execution",
      "single clear focal subject with subtle market context",
      "imagery that feels introspective and analytical rather than hype-driven",
    ],
    composition: [
      "minimal and spacious composition",
      "smooth, refined lighting with a soft premium editorial feel",
      "keep the image believable and useful as a homepage/article hero",
    ],
    avoid: [
      "loud neon colors",
      "crypto-bro hype visuals, rockets, explosions, flex culture",
      "cartoon styles, glossy 3D blobs, fake trading dashboards full of tiny text",
    ],
  },
  {
    slug: "sooda",
    aliases: ["sooda", "sooda.app"],
    brandName: "Sooda",
    visualDirection: [
      "bold, practical small-business product marketing",
      "confident, modern, mobile-first SaaS energy",
      "clean and useful rather than luxurious or moody",
    ],
    palette: [
      "strong vivid cobalt or electric blue as the hero color family",
      "clean white for contrast",
      "very limited supporting neutrals",
    ],
    imagery: [
      "inventory, products, packaging, shelves, barcode scanning, checkout, organized stock workflows",
      "small business operations and retail moments",
      "clear commerce-related subject matter tied to inventory and sales",
    ],
    composition: [
      "high clarity and straightforward layout",
      "bright, punchy, promotional hero feel",
      "simple large shapes and obvious focal point",
    ],
    avoid: [
      "dark cinematic finance scenes",
      "beige lifestyle minimalism",
      "purple-heavy palettes",
      "messy cluttered compositions or unreadable app UI mockups",
    ],
  },
  {
    slug: "myspaces",
    aliases: ["myspaces", "myspaces.app"],
    brandName: "MySpaces",
    visualDirection: [
      "playful productivity with clean browser-tool polish",
      "friendly and modern rather than corporate",
      "slightly illustrative, light, and approachable",
    ],
    palette: [
      "soft lavender, violet, and purple accents",
      "very light lilac-tinted or white background feel",
      "dark ink-like linework for definition",
    ],
    imagery: [
      "browser tabs, workspace organization, digital clutter turning into structure",
      "light illustration-friendly productivity scenes",
      "organized digital workspaces and tab-management concepts",
    ],
    composition: [
      "airy layout with soft gradient atmosphere",
      "simple playful motion or energy cues",
      "clear focal subject with room around it",
    ],
    avoid: [
      "harsh corporate blue enterprise visuals",
      "moody dark photography",
      "overly realistic office-team stock photos",
      "heavy orange, green, or red dominant palettes",
    ],
  },
];

function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}

function collectNormalizedSiteTokens(siteSlugs?: string[], siteNames?: string[], siteDomains?: string[]): string[] {
  return [...(siteSlugs ?? []), ...(siteNames ?? []), ...(siteDomains ?? [])]
    .map(normalizeValue)
    .filter(Boolean);
}

export function buildSiteBrandGuideText(
  siteSlugs?: string[],
  siteNames?: string[],
  siteDomains?: string[],
): string[] {
  const tokens = collectNormalizedSiteTokens(siteSlugs, siteNames, siteDomains);
  const matchedGuides = SITE_BRAND_GUIDES.filter((guide) =>
    guide.aliases.some((alias) => tokens.includes(normalizeValue(alias)))
  );

  return matchedGuides.map((guide) => [
    `Site-specific visual instructions for ${guide.brandName}:`,
    `Overall tone: ${guide.visualDirection.join("; ")}.`,
    `Color direction: ${guide.palette.join("; ")}.`,
    `Preferred subject matter: ${guide.imagery.join("; ")}.`,
    `Composition guidance: ${guide.composition.join("; ")}.`,
    `Avoid: ${guide.avoid.join("; ")}.`,
  ].join("\n"));
}
