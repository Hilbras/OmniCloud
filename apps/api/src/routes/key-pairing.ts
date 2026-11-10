import type { FastifyInstance } from "fastify";
import { ValidationError } from "@omnicloud/core";
import type { KeyPairingCreatedDTO, KeyPairingPayloadDTO } from "@omnicloud/shared";
import type { Container } from "../container";
import { createRateLimiter } from "../rate-limit";
import { requireBody, requireString } from "../validation";

/** One-time encrypted URK transfer to a second signed-in device. */
export function registerKeyPairingRoutes(app: FastifyInstance, container: Container): void {
  const claimLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });

  app.post("/api/key-pairing", async (request, reply) => {
    const body = requireBody(request);
    const wrappedUrk = requireString(body, "wrappedUrk");
    const fileId = requireString(body, "fileId");
    const versionId = requireString(body, "versionId");
    const epochRaw = (body as Record<string, unknown>).keyEpoch;
    if (typeof epochRaw !== "number") {
      throw new ValidationError("keyEpoch must be a number");
    }
    const ttlRaw = (body as Record<string, unknown>).expiresInSeconds;
    const expiresInSeconds =
      ttlRaw === undefined
        ? undefined
        : typeof ttlRaw === "number"
          ? ttlRaw
          : (() => {
              throw new ValidationError("expiresInSeconds must be a number");
            })();

    const pairing = await container.keyPairings.create(request.user.id, {
      wrappedUrk,
      fileId,
      versionId,
      keyEpoch: epochRaw,
      ...(expiresInSeconds !== undefined ? { expiresInSeconds } : {}),
    });
    return reply.status(201).send({
      id: pairing.id,
      expiresAt: pairing.expiresAt.toISOString(),
    } satisfies KeyPairingCreatedDTO);
  });

  app.get("/api/key-pairing/:id", async (request) => {
    claimLimiter(request.ip);
    const { id } = request.params as { id: string };
    const pairing = await container.keyPairings.claim(request.user.id, id);
    return {
      id: pairing.id,
      wrappedUrk: pairing.wrappedUrk,
      fileId: pairing.fileId,
      versionId: pairing.versionId,
      keyEpoch: pairing.keyEpoch,
      expiresAt: pairing.expiresAt.toISOString(),
    } satisfies KeyPairingPayloadDTO;
  });
}
