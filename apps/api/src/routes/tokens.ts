import type { FastifyInstance } from "fastify";
import { ValidationError } from "@omnicloud/core";
import type { Container } from "../container";

/**
 * Personal API tokens. Creating a token returns its secret exactly once; listing
 * returns metadata only, and revoking takes effect on the token's next use.
 */
export function registerTokenRoutes(app: FastifyInstance, container: Container): void {
  app.post("/api/tokens", async (request, reply) => {
    const body = (request.body ?? {}) as { name?: unknown };
    if (typeof body.name !== "string") throw new ValidationError("A token name is required");
    const issued = await container.apiTokens.issue(request.user.id, body.name);
    return reply.status(201).send({
      id: issued.record.id,
      name: issued.record.name,
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
