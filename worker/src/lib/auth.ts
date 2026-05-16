/**
 * Bearer-token auth middleware.
 *
 * why constant-time compare: a naive `===` against the token would leak
 * a timing side-channel — each correctly-matched byte takes slightly
 * longer to reject. Over enough requests an attacker could in principle
 * recover the token byte-by-byte. `crypto.timingSafeEqual` is the
 * standard fix and is essentially free in our hot path.
 *
 * Auth flow:
 *   1. Read Authorization header.
 *   2. Require "Bearer <token>" shape — anything else → 401.
 *   3. Compare against WORKER_AUTH_TOKEN with timingSafeEqual.
 *   4. On match, call next(); on mismatch, 401.
 *
 * The token comes in via res.locals.env (set in server.ts) so the
 * middleware is pure with respect to its enclosing scope and easy to
 * unit-test by injecting a different env.
 */

import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

import type { Env } from "./env.js";

/**
 * Build the auth middleware bound to a specific env. Returns a standard
 * Express middleware. Returns 401 with a generic body on any failure —
 * we deliberately do not distinguish "missing header" from "wrong token"
 * to avoid giving callers diagnostic info.
 */
export function makeAuthMiddleware(env: Env) {
  // Pre-encode the expected token to a Buffer once at middleware-build
  // time so every request only allocates the per-request Buffer.
  const expected = Buffer.from(env.WORKER_AUTH_TOKEN, "utf8");

  return function authMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const header = req.header("authorization");
    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }

    const provided = Buffer.from(header.slice("Bearer ".length), "utf8");

    // timingSafeEqual requires equal lengths; differing lengths would
    // throw, so check first and short-circuit. Length-mismatch is also
    // a "wrong token" outcome from the client's POV.
    if (provided.length !== expected.length) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }

    if (!timingSafeEqual(provided, expected)) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }

    next();
  };
}
