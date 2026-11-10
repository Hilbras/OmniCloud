import type { FastifyInstance } from "fastify";
import { ValidationError, isApiTokenScope } from "@omnicloud/core";
import type { Container } from "../container";

/**
 * Personal API tokens. Creating a token returns its secret exactly once; listing
 * returns metadata only, and revoking takes effect on the token's next use.
 */
export function registerTokenRoutes(app: FastifyInstance, container: Container): void {
  app.post("/api/tokens", async (request, reply) => {
    const body = (request.body ?? {}) as {
      name?: unknown;
      readOnly?: unknown;
      scope?: unknown;
      expiresAt?: unknown;
    };
    if (typeof body.name !== "string") throw new ValidationError("A token name is required");
    if (body.readOnly !== undefined && typeof body.readOnly !== "boolean") {
      throw new ValidationError("readOnly must be a boolean");
    }
    if (body.scope !== undefined && !isApiTokenScope(body.scope)) {
      throw new ValidationError("scope must be full, upload or webdav");
    }
    let expiresAt: Date | null = null;
    if (body.expiresAt !== undefined && body.expiresAt !== null) {
      if (typeof body.expiresAt !== "string") {
        throw new ValidationError("expiresAt must be an ISO-8601 string");
      }
      expiresAt = new Date(body.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) {
        throw new ValidationError("expiresAt must be an ISO-8601 string");
      }
    }
    const issued = await container.apiTokens.issue(request.user.id, body.name, {
      readOnly: body.readOnly === true,
      ...(body.scope !== undefined ? { scope: body.scope } : {}),
      expiresAt,
    });
    return reply.status(201).send({
      id: issued.record.id,
      name: issued.record.name,
      readOnly: issued.record.readOnly,
      scope: issued.record.scope,
      expiresAt: issued.record.expiresAt?.toISOString() ?? null,
      createdAt: issued.record.createdAt.toISOString(),
      token: issued.token,
    });
  });

  app.get("/api/tokens", async (request) => {
    const tokens = await container.apiTokens.list(request.user.id);
    return {
      tokens: tokens.map((t) => ({
        id: t.id,
        name: t.name,
        readOnly: t.readOnly,
        scope: t.scope,
        expiresAt: t.expiresAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
        lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
        revokedAt: t.revokedAt?.toISOString() ?? null,
      })),
    };
  });

  app.delete("/api/tokens/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await container.apiTokens.revoke(request.user.id, id);
    return reply.status(204).send();
  });
}
