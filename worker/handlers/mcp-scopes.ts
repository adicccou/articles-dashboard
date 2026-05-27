export type McpOAuthScope = "posts.read" | "posts.write" | "posts.publish";

export type McpScopeAuthContext = {
  authMode: "internal" | "oauth";
  scopes: readonly string[];
};

export function requireMcpScopes(auth: McpScopeAuthContext, ...requiredScopes: McpOAuthScope[]) {
  if (auth.authMode === "internal") return;
  const granted = new Set(auth.scopes);
  const missing = requiredScopes.filter((scope) => !granted.has(scope));
  if (!missing.length) return;
  throw new Error(
    `This tool requires the ${missing.join(", ")} OAuth scope. Reconnect Oilor Studio in ChatGPT with the requested permissions, then try again.`,
  );
}
