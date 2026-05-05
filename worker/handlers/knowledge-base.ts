import type { Env } from "../lib/types";
import { parseJson, jsonResponse, errorResponse } from "../lib/http";

interface SaveKBPayload {
  title: string;
  content: string;
  change_summary?: string;
}

const allowedKnowledgeBaseTypes = ["reddit_campaign", "trading_strategy", "social_platform"];

export async function getKnowledgeBase(
  env: Env,
  type: string,
  id: string,
): Promise<Response> {
  try {
    if (!allowedKnowledgeBaseTypes.includes(type)) {
      return errorResponse("Invalid entity type", 400);
    }

    const entityId = Number(id);
    if (isNaN(entityId)) {
      return errorResponse("Invalid entity ID", 400);
    }

    const kb = await env.DB.prepare(
      "SELECT * FROM knowledge_bases WHERE entity_type = ? AND entity_id = ?",
    )
      .bind(type, entityId)
      .first();

    if (!kb) {
      return jsonResponse({ id: null, title: "", content: "", version: 0 });
    }

    return jsonResponse(kb);
  } catch (error) {
    return errorResponse("Failed to fetch knowledge base", 500);
  }
}

export async function saveKnowledgeBase(
  env: Env,
  type: string,
  id: string,
  request: Request,
): Promise<Response> {
  try {
    if (!allowedKnowledgeBaseTypes.includes(type)) {
      return errorResponse("Invalid entity type", 400);
    }

    const entityId = Number(id);
    if (isNaN(entityId)) {
      return errorResponse("Invalid entity ID", 400);
    }

    const payload = await parseJson<SaveKBPayload>(request);
    if (!payload.title || !payload.content) {
      return errorResponse("Title and content are required", 400);
    }

    const now = new Date().toISOString();

    const existing = await env.DB.prepare(
      "SELECT id, version, content FROM knowledge_bases WHERE entity_type = ? AND entity_id = ?",
    )
      .bind(type, entityId)
      .first();

    if (existing) {
      // Update existing KB and create version history entry
      const currentVersion = Number(existing.version) || 0;
      const newVersion = currentVersion + 1;

      await env.DB.prepare(
        "UPDATE knowledge_bases SET title = ?, content = ?, version = ?, updated_at = ? WHERE id = ?",
      )
        .bind(payload.title, payload.content, newVersion, now, existing.id)
        .run();

      try {
        await env.DB.prepare(
          "INSERT INTO knowledge_base_versions (knowledge_base_id, version, content, change_summary, created_at) VALUES (?, ?, ?, ?, ?)",
        )
          .bind(existing.id, currentVersion, String(existing.content ?? ""), payload.change_summary || null, now)
          .run();
      } catch {
        // Some older D1 databases have stale FK metadata on the optional history table.
        // Saving the current knowledge base should not fail because history is unavailable.
      }

      return jsonResponse(
        {
          id: existing.id,
          entity_type: type,
          entity_id: entityId,
          title: payload.title,
          content: payload.content,
          version: newVersion,
          updated_at: now,
        },
        { status: 200 },
      );
    } else {
      // Create new KB
      const result = await env.DB.prepare(
        `INSERT INTO knowledge_bases (entity_type, entity_id, title, content, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
        .bind(type, entityId, payload.title, payload.content, now, now)
        .run() as { meta: { last_row_id: number } };

      return jsonResponse(
        {
          id: result.meta.last_row_id,
          entity_type: type,
          entity_id: entityId,
          title: payload.title,
          content: payload.content,
          version: 1,
          created_at: now,
          updated_at: now,
        },
        { status: 201 },
      );
    }
  } catch (error) {
    return errorResponse("Failed to save knowledge base", 500);
  }
}

export async function getVersions(
  env: Env,
  type: string,
  id: string,
): Promise<Response> {
  try {
    if (!allowedKnowledgeBaseTypes.includes(type)) {
      return errorResponse("Invalid entity type", 400);
    }

    const entityId = Number(id);
    if (isNaN(entityId)) {
      return errorResponse("Invalid entity ID", 400);
    }

    const kb = await env.DB.prepare(
      "SELECT id FROM knowledge_bases WHERE entity_type = ? AND entity_id = ?",
    )
      .bind(type, entityId)
      .first();

    if (!kb) {
      return jsonResponse([]);
    }

    const versions = await env.DB.prepare(
      "SELECT * FROM knowledge_base_versions WHERE knowledge_base_id = ? ORDER BY version DESC",
    )
      .bind(kb.id)
      .all();

    return jsonResponse(versions.results || []);
  } catch (error) {
    return errorResponse("Failed to fetch versions", 500);
  }
}

export async function getVersion(
  env: Env,
  type: string,
  id: string,
  version: string,
): Promise<Response> {
  try {
    if (!allowedKnowledgeBaseTypes.includes(type)) {
      return errorResponse("Invalid entity type", 400);
    }

    const entityId = Number(id);
    const versionNum = Number(version);
    if (isNaN(entityId) || isNaN(versionNum)) {
      return errorResponse("Invalid entity ID or version", 400);
    }

    const kb = await env.DB.prepare(
      "SELECT id FROM knowledge_bases WHERE entity_type = ? AND entity_id = ?",
    )
      .bind(type, entityId)
      .first();

    if (!kb) {
      return errorResponse("Knowledge base not found", 404);
    }

    const versionRecord = await env.DB.prepare(
      "SELECT * FROM knowledge_base_versions WHERE knowledge_base_id = ? AND version = ?",
    )
      .bind(kb.id, versionNum)
      .first();

    if (!versionRecord) {
      return errorResponse("Version not found", 404);
    }

    return jsonResponse(versionRecord);
  } catch (error) {
    return errorResponse("Failed to fetch version", 500);
  }
}
