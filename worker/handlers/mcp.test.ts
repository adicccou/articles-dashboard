import { describe, expect, it } from "vitest";
import { requireMcpScopes } from "./mcp-scopes";

const baseAuth = {
  userId: 1,
  scopeId: 1,
  workspaceId: 1,
};

describe("MCP OAuth scope enforcement", () => {
  it("allows internal token connections to use all MCP tools", () => {
    expect(() => requireMcpScopes({
      ...baseAuth,
      authMode: "internal",
      scopes: [],
    }, "posts.write", "posts.publish")).not.toThrow();
  });

  it("allows OAuth tools when the token has the required scope", () => {
    expect(() => requireMcpScopes({
      ...baseAuth,
      authMode: "oauth",
      scopes: ["posts.read", "posts.write"],
    }, "posts.write")).not.toThrow();
  });

  it("does not require read permission for write-only OAuth tools", () => {
    expect(() => requireMcpScopes({
      ...baseAuth,
      authMode: "oauth",
      scopes: ["posts.write"],
    }, "posts.write")).not.toThrow();
  });

  it("blocks write tools for read-only OAuth tokens", () => {
    expect(() => requireMcpScopes({
      ...baseAuth,
      authMode: "oauth",
      scopes: ["posts.read"],
    }, "posts.write")).toThrow(/posts\.write OAuth scope/);
  });

  it("blocks read tools for write-only OAuth tokens", () => {
    expect(() => requireMcpScopes({
      ...baseAuth,
      authMode: "oauth",
      scopes: ["posts.write"],
    }, "posts.read")).toThrow(/posts\.read OAuth scope/);
  });

  it("blocks publish tools unless the OAuth token has publish permission", () => {
    expect(() => requireMcpScopes({
      ...baseAuth,
      authMode: "oauth",
      scopes: ["posts.read", "posts.write"],
    }, "posts.publish")).toThrow(/posts\.publish OAuth scope/);
  });
});
