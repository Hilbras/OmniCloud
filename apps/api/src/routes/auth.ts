import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ForbiddenError, UnauthorizedError, ValidationError } from "@omnicloud/core";
import { SESSION_COOKIE } from "@omnicloud/shared";
import type { Container } from "../container";
import { currentUser, currentUserWithToken, issueSessionCookie, wantsSessionToken } from "../auth";
import { isAllowedOrigin } from "../http";
import { createRateLimiter } from "../rate-limit";
import { parseRecoveryBlob, requireBody, requireString } from "../validation";
import { toStorageDTO, toStorageHealthDTO, toUserDTO } from "../mappers";
import type { TelegramVerifyResponse } from "@omnicloud/shared";

const PHONE_PATTERN = /^\+?[0-9]\d{4,14}$/;

/**
 * Telegram connection + browser session endpoints.
 *
 * Flow: POST /telegram/start sends the login code, POST /telegram/verify
 * checks it, POST /telegram/password completes two-factor sign-in.
 * The MTProto session is stored server-side only and never logged.
 */
export function registerAuthRoutes(app: FastifyInstance, container: Container): void {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 10 });
  // The status route is a read-only poll the UI repeats every few seconds, so it
  // needs its own, larger budget rather than the sign-in limiter's ten per minute.
  const statusLimiter = createRateLimiter({ windowMs: 60_000, max: 120 });

  // ── Deployment mode (public: the login page branches on it) ──────────────
  app.get("/api/auth/mode", async () => ({
    authMode: container.config.authMode,
    storageProvider: container.config.storageProvider,
  }));

  // ── Local single-account sign-in (AUTH_MODE=local) ───────────────────────
  app.post("/api/auth/local", async (request, reply) => {
    if (container.config.authMode !== "local") {
      throw new ValidationError("Local sign-in is not enabled");
    }
    limiter(request.ip);
    const body = requireBody(request);
    const email = requireString(body, "email").trim().toLowerCase();
    const password = requireString(body, "password");
    const expectedEmail = container.config.localAuthEmail.trim().toLowerCase();
    const expectedPassword = container.config.localAuthPassword;

    const digest = (value: string): Buffer => createHash("sha256").update(value).digest();
    const emailMatches = timingSafeEqual(digest(email), digest(expectedEmail));
    const passwordMatches = timingSafeEqual(digest(password), digest(expectedPassword));
    if (!emailMatches || !passwordMatches) {
      throw new UnauthorizedError("Wrong email or password");
    }

    // Stable synthetic Telegram id derived from the email; the local account
    // does not talk to Telegram, but the user row stays compatible.
    const syntheticId = BigInt(
      `0x8${createHash("sha256").update(email).digest("hex").slice(0, 12)}`,
    ).toString();
    const user = await container.repos.users.upsertFromTelegram({
      telegramUserId: syntheticId,
      username: email,
      firstName: "Local",
      lastName: null,
      phone: null,
    });
    const sessionToken = await issueSessionCookie(
      container.authSessions,
      request,
      reply,
      user.id,
      container.config.cookieSecure,
    );
    return reply.send({
      status: "ok",
      user: toUserDTO(user),
      ...(wantsSessionToken(request) ? { sessionToken } : {}),
    });
  });

  // ── Start: send the Telegram confirmation code ───────────────────────────
  app.post("/api/auth/telegram/start", async (request, reply) => {
    limiter(request.ip);
    const body = requireBody(request);
    const phone = requireString(body, "phone");
    if (!PHONE_PATTERN.test(phone)) {
      throw new ValidationError("Please provide a valid phone number in international format");
    }
    await container.connection.startLogin(phone);
    return reply.send({ ok: true });
  });

  // ── Verify the confirmation code ─────────────────────────────────────────
  app.post("/api/auth/telegram/verify", async (request, reply) => {
    limiter(request.ip);
    const body = requireBody(request);
    const phone = requireString(body, "phone");
    const code = requireString(body, "code");
    if (!/^\d{3,10}$/.test(code)) {
      throw new ValidationError("Please provide the numeric Telegram login code");
    }

    const result = await container.connection.verifyCode(phone, code);
    if (result.status === "password_required") {
      const response: TelegramVerifyResponse = { status: "password_required" };
      return reply.send(response);
    }

    const sessionToken = await issueSessionCookie(
      container.authSessions,
      request,
      reply,
      result.user.id,
      container.config.cookieSecure,
    );
    const response: TelegramVerifyResponse = {
      status: "ok",
      user: toUserDTO(result.user),
      ...(wantsSessionToken(request) ? { sessionToken } : {}),
    };
    return reply.send(response);
  });

  // ── Two-factor password step ─────────────────────────────────────────────
  app.post("/api/auth/telegram/password", async (request, reply) => {
    limiter(request.ip);
    const body = requireBody(request);
    const phone = requireString(body, "phone");
    const password = requireString(body, "password");
    if (password.length < 1) {
      throw new ValidationError("Please provide the two-factor password");
    }

    const result = await container.connection.verifyPassword(phone, password);
    if (result.status !== "ok") {
      // Defensive: password verification always terminates the flow.
      throw new ValidationError("Sign-in incomplete");
    }

    const sessionToken = await issueSessionCookie(
      container.authSessions,
      request,
      reply,
      result.user.id,
      container.config.cookieSecure,
    );
    return reply.send({
      status: "ok",
      user: toUserDTO(result.user),
      ...(wantsSessionToken(request) ? { sessionToken } : {}),
    });
  });

  // ── QR sign-in: the phone approves a token shown as a QR code ────────────
  app.post("/api/auth/telegram/qr/start", async (request, reply) => {
    limiter(request.ip);
    const started = await container.connection.startQrLogin();
    return reply.send({ flowId: started.flowId, token: started.token });
  });

  app.post("/api/auth/telegram/qr/status", async (request, reply) => {
    // This route can issue a session cookie once the phone approves. It is POST
    // so a cross-site top-level navigation cannot trigger it with a Lax cookie,
    // and the Origin allow-list rejects cross-origin form posts.
    if (
      !isAllowedOrigin(
        request.headers.origin,
        request.headers.host,
        container.config.allowedOrigins,
      )
    ) {
      throw new ForbiddenError("Cross-origin request rejected");
    }
    statusLimiter(request.ip);
    const body = requireBody(request);
    const flowId = requireString(body, "flowId");
    const result = await container.connection.pollQrLogin(flowId);
    if (result.status === "approved") {
      const sessionToken = await issueSessionCookie(
        container.authSessions,
        request,
        reply,
        result.user.id,
        container.config.cookieSecure,
      );
      return reply.send({
        status: "ok",
        user: toUserDTO(result.user),
        ...(wantsSessionToken(request) ? { sessionToken } : {}),
      });
    }
    return reply.send(result);
  });

  app.post("/api/auth/telegram/qr/password", async (request, reply) => {
    limiter(request.ip);
    const body = requireBody(request);
    const flowId = requireString(body, "flowId");
    const password = requireString(body, "password");
    const result = await container.connection.submitQrPassword(flowId, password);
    const sessionToken = await issueSessionCookie(
      container.authSessions,
      request,
      reply,
      result.user.id,
      container.config.cookieSecure,
    );
    return reply.send({
      status: "ok",
      user: toUserDTO(result.user),
      ...(wantsSessionToken(request) ? { sessionToken } : {}),
    });
  });

  // ── Current session (public: returns nulls when signed out) ──────────────
  app.get("/api/auth/me", async (request) => {
    const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? "")?.[1];
    const bearerSession =
      bearer === undefined ? null : await container.authSessions.resolve(bearer);
    const user = bearerSession
      ? await container.repos.users.findById(bearerSession.userId)
      : await currentUser(container.repos, container.authSessions, request.cookies);
    if (!user) return { user: null, storage: null, health: null };

    const provider = container.config.storageProvider === "local" ? "local" : "telegram";
    const storage = await container.repos.storages.findByUserAndProvider(user.id, provider);
    if (!storage) return { user: toUserDTO(user), storage: null, health: null };

    // A light status read (no Telegram round-trip) keeps /me fast.
    const status = await container.storageHealth.health(user.id, false);
    return {
      user: toUserDTO(user),
      storage: toStorageDTO(storage),
      health: toStorageHealthDTO({
        provider,
        state: status.state,
        healthy: status.healthy,
        latencyMs: status.latencyMs,
        message: status.message,
        targetTitle: status.targetTitle,
      }),
    };
  });

  // ── OCE1 recovery blob (opaque ciphertext; the code never reaches the
  // server, so these endpoints only store/retrieve ciphertext for the owner).
  const recoveryLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });

  app.get("/api/auth/recovery", async (request, reply) => {
    const user = await currentUserWithToken(
      container.repos,
      container.authSessions,
      container.apiTokens,
      request.headers,
      request.cookies,
    );
    if (!user)
      return reply.status(401).send({ error: { code: "AUTH_REQUIRED", message: "Sign in first" } });
    const recoveryBlob = await container.repos.users.getRecoveryBlob(user.id);
    return { recoveryBlob };
  });

  app.put("/api/auth/recovery", async (request, reply) => {
    recoveryLimiter(request.ip);
    const user = await currentUserWithToken(
      container.repos,
      container.authSessions,
      container.apiTokens,
      request.headers,
      request.cookies,
    );
    if (!user)
      return reply.status(401).send({ error: { code: "AUTH_REQUIRED", message: "Sign in first" } });
    const recoveryBlob = parseRecoveryBlob(request);
    await container.repos.users.setRecoveryBlob(user.id, recoveryBlob);
    return { status: "ok" };
  });

  app.delete("/api/auth/recovery", async (request, reply) => {
    recoveryLimiter(request.ip);
    const user = await currentUserWithToken(
      container.repos,
      container.authSessions,
      container.apiTokens,
      request.headers,
      request.cookies,
    );
    if (!user)
      return reply.status(401).send({ error: { code: "AUTH_REQUIRED", message: "Sign in first" } });
    await container.repos.users.setRecoveryBlob(user.id, null);
    return { status: "ok" };
  });

  // ── Sign out everywhere: revokes every browser session for this account ──
  app.post("/api/auth/logout-all", async (request, reply) => {
    const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? "")?.[1];
    const session =
      bearer === undefined
        ? await container.authSessions.resolve(request.cookies[SESSION_COOKIE])
        : await container.authSessions.resolve(bearer);
    const user = session ? await container.repos.users.findById(session.userId) : null;
    if (!user)
      return reply.status(401).send({ error: { code: "AUTH_REQUIRED", message: "Sign in first" } });
    const revoked = await container.authSessions.revokeAll(user.id);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true, revoked };
  });

  // ── Logout ────────────────────────────────────────────────────────────────
  app.post("/api/auth/logout", async (request, reply) => {
    const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? "")?.[1];
    const rawToken = bearer ?? request.cookies[SESSION_COOKIE];
    const session = await container.authSessions.resolve(rawToken);
    const user = session ? await container.repos.users.findById(session.userId) : null;
    await container.authSessions.revoke(rawToken);
    if (user) await container.storageHealth.disconnect(user.id);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });
}
