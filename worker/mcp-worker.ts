import type { Env } from "./lib/types";
import { handleMcpRequest } from "./handlers/mcp";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleMcpRequest(request, env, ctx);
  },
};
