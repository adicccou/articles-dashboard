export type StudioAppProfile = {
  category: string;
  target_users: string;
  skill_level: string;
  not_for: string;
  problem_before: string;
  current_alternatives: string[];
  frustrations: string[];
  positioning_statement: string;
  main_promise: string;
  main_differentiation: string;
  competitors: string[];
  top_features: string[];
  feature_benefits: string[];
  screens_to_show: string[];
  proof_points: string[];
  example_cases: string[];
  brand_tone: string;
  words_to_use: string[];
  words_to_avoid: string[];
  forbidden_claims: string[];
  best_platforms: string[];
  content_angles: string[];
  reply_style: string;
  target_posts: string[];
  reject_signals: string[];
  pricing_summary: string;
  main_cta: string;
  offer_details: string;
  agent_instructions: string;
};

const LIST_LIMIT = 24;

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseJsonValue(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeList(value: unknown) {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim().startsWith("[")
      ? normalizeList(parseJsonValue(value))
      : typeof value === "string"
        ? value.split(/[\n,]+/)
        : [];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const item of items) {
    const line = normalizeText(item);
    if (!line || seen.has(line.toLowerCase())) continue;
    seen.add(line.toLowerCase());
    lines.push(line);
    if (lines.length >= LIST_LIMIT) break;
  }
  return lines;
}

function isFilled(value: string | string[]) {
  return Array.isArray(value) ? value.length > 0 : value.trim().length > 0;
}

function formatList(label: string, values: string[]) {
  if (!values.length) return "";
  return `${label}:\n${values.map((value) => `- ${value}`).join("\n")}`;
}

export function emptyStudioAppProfile(): StudioAppProfile {
  return {
    category: "",
    target_users: "",
    skill_level: "",
    not_for: "",
    problem_before: "",
    current_alternatives: [],
    frustrations: [],
    positioning_statement: "",
    main_promise: "",
    main_differentiation: "",
    competitors: [],
    top_features: [],
    feature_benefits: [],
    screens_to_show: [],
    proof_points: [],
    example_cases: [],
    brand_tone: "",
    words_to_use: [],
    words_to_avoid: [],
    forbidden_claims: [],
    best_platforms: [],
    content_angles: [],
    reply_style: "",
    target_posts: [],
    reject_signals: [],
    pricing_summary: "",
    main_cta: "",
    offer_details: "",
    agent_instructions: "",
  };
}

export function normalizeStudioAppProfile(value: unknown): StudioAppProfile {
  const raw = typeof value === "string"
    ? parseJsonObject(value)
    : value && typeof value === "object"
      ? value as Record<string, unknown>
      : {};
  return {
    category: normalizeText(raw.category),
    target_users: normalizeText(raw.target_users),
    skill_level: normalizeText(raw.skill_level),
    not_for: normalizeText(raw.not_for),
    problem_before: normalizeText(raw.problem_before),
    current_alternatives: normalizeList(raw.current_alternatives),
    frustrations: normalizeList(raw.frustrations),
    positioning_statement: normalizeText(raw.positioning_statement),
    main_promise: normalizeText(raw.main_promise),
    main_differentiation: normalizeText(raw.main_differentiation),
    competitors: normalizeList(raw.competitors),
    top_features: normalizeList(raw.top_features),
    feature_benefits: normalizeList(raw.feature_benefits),
    screens_to_show: normalizeList(raw.screens_to_show),
    proof_points: normalizeList(raw.proof_points),
    example_cases: normalizeList(raw.example_cases),
    brand_tone: normalizeText(raw.brand_tone),
    words_to_use: normalizeList(raw.words_to_use),
    words_to_avoid: normalizeList(raw.words_to_avoid),
    forbidden_claims: normalizeList(raw.forbidden_claims),
    best_platforms: normalizeList(raw.best_platforms),
    content_angles: normalizeList(raw.content_angles),
    reply_style: normalizeText(raw.reply_style),
    target_posts: normalizeList(raw.target_posts),
    reject_signals: normalizeList(raw.reject_signals),
    pricing_summary: normalizeText(raw.pricing_summary),
    main_cta: normalizeText(raw.main_cta),
    offer_details: normalizeText(raw.offer_details),
    agent_instructions: normalizeText(raw.agent_instructions),
  };
}

export function splitStudioAppProfileList(value: string) {
  return normalizeList(value);
}

export function joinStudioAppProfileList(values: readonly string[]) {
  return values.join("\n");
}

export function hasStudioAppProfileContent(profile: StudioAppProfile) {
  return Object.values(profile).some((value) => isFilled(value as string | string[]));
}

export function summarizeStudioAppProfile(profile: StudioAppProfile) {
  const normalized = normalizeStudioAppProfile(profile);
  return [
    normalized.category ? `Category: ${normalized.category}` : "",
    normalized.target_users ? `Target users: ${normalized.target_users}` : "",
    normalized.problem_before ? `Core problem: ${normalized.problem_before}` : "",
    normalized.main_promise ? `Main promise: ${normalized.main_promise}` : "",
    normalized.main_differentiation ? `Differentiation: ${normalized.main_differentiation}` : "",
    normalized.competitors.length ? `Alternatives: ${normalized.competitors.join(", ")}` : "",
    normalized.content_angles.length ? `Content angles: ${normalized.content_angles.join(", ")}` : "",
  ].filter(Boolean).join(" | ");
}

export function formatStudioAppProfile(profile: StudioAppProfile) {
  const normalized = normalizeStudioAppProfile(profile);
  const sections: string[] = [];

  const basicIdentity = [
    normalized.category ? `Category: ${normalized.category}` : "",
  ].filter(Boolean);
  if (basicIdentity.length) sections.push(`BASIC IDENTITY\n${basicIdentity.join("\n")}`);

  const audience = [
    normalized.target_users ? `Target users: ${normalized.target_users}` : "",
    normalized.skill_level ? `Skill level: ${normalized.skill_level}` : "",
    normalized.not_for ? `Not for: ${normalized.not_for}` : "",
  ].filter(Boolean);
  if (audience.length) sections.push(`WHO IT IS FOR\n${audience.join("\n")}`);

  const painPoints = [
    normalized.problem_before ? `Problem before discovery: ${normalized.problem_before}` : "",
    formatList("Current alternatives", normalized.current_alternatives),
    formatList("Frustrations", normalized.frustrations),
  ].filter(Boolean);
  if (painPoints.length) sections.push(`PAIN POINTS\n${painPoints.join("\n")}`);

  const positioning = [
    normalized.positioning_statement ? `Positioning: ${normalized.positioning_statement}` : "",
    normalized.main_promise ? `Main promise: ${normalized.main_promise}` : "",
    normalized.main_differentiation ? `Main differentiation: ${normalized.main_differentiation}` : "",
    formatList("Competitors and alternatives", normalized.competitors),
  ].filter(Boolean);
  if (positioning.length) sections.push(`POSITIONING\n${positioning.join("\n")}`);

  const features = [
    formatList("Top features", normalized.top_features),
    formatList("Feature benefits", normalized.feature_benefits),
    formatList("Screens and workflows to show", normalized.screens_to_show),
  ].filter(Boolean);
  if (features.length) sections.push(`FEATURES\n${features.join("\n")}`);

  const proof = [
    formatList("Proof points", normalized.proof_points),
    formatList("Examples and cases", normalized.example_cases),
  ].filter(Boolean);
  if (proof.length) sections.push(`PROOF\n${proof.join("\n")}`);

  const voice = [
    normalized.brand_tone ? `Brand tone: ${normalized.brand_tone}` : "",
    formatList("Words to use", normalized.words_to_use),
    formatList("Words to avoid", normalized.words_to_avoid),
    formatList("Claims to avoid", normalized.forbidden_claims),
  ].filter(Boolean);
  if (voice.length) sections.push(`VOICE AND RULES\n${voice.join("\n")}`);

  const social = [
    formatList("Best platforms", normalized.best_platforms),
    formatList("Content angles", normalized.content_angles),
    normalized.reply_style ? `Reply style: ${normalized.reply_style}` : "",
    formatList("Posts and comments to target", normalized.target_posts),
    formatList("Low-quality items to reject", normalized.reject_signals),
  ].filter(Boolean);
  if (social.length) sections.push(`SOCIAL STRATEGY\n${social.join("\n")}`);

  const offer = [
    normalized.pricing_summary ? `Pricing: ${normalized.pricing_summary}` : "",
    normalized.main_cta ? `Main CTA: ${normalized.main_cta}` : "",
    normalized.offer_details ? `Offer details: ${normalized.offer_details}` : "",
  ].filter(Boolean);
  if (offer.length) sections.push(`OFFER\n${offer.join("\n")}`);

  if (normalized.agent_instructions) {
    sections.push(`AGENT INSTRUCTIONS\n${normalized.agent_instructions}`);
  }

  return sections.join("\n\n");
}
