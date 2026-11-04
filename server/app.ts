import express, { type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { ZodError } from "zod";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { Database } from "./db.js";
import { ApiError } from "./errors.js";
import type { AppOptions } from "./types.js";
import { csrfProtection, loadAuth, requireAuth, requireStore } from "./auth.js";
import { createAiRouter } from "./ai.js";
import { registerIdentityRoutes } from "./routes/identity.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerShoppingRoutes } from "./routes/shopping.js";
import { registerReportingRoutes } from "./routes/reporting.js";
import { createStripeWebhook } from "./stripe.js";
import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";

export function createApp(db: Database, options: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const requestId = randomUUID();
    req.requestId = requestId;
    res.set("X-Request-ID", requestId);
    const started = performance.now();
    res.on("finish", () => {
      if (req.path !== "/api/health")
        logger.info(
          {
            requestId,
            method: req.method,
            path: req.path,
            status: res.statusCode,
            durationMs: Math.round(performance.now() - started),
          },
          "Request completed",
        );
    });
    next();
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", "data:"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: options.production ? [] : null,
        },
      },
    }),
  );
  app.post(
    "/api/payments/stripe/webhook",
    express.raw({ type: "application/json", limit: "256kb" }),
    createStripeWebhook(db),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(
    "/api",
    rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: "draft-8", legacyHeaders: false }),
  );
  app.get("/api/health", async (_req, res) => {
    await db.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  });
  app.use("/api", loadAuth(db), csrfProtection(options.origin, options.production));
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api", async (req, _res, next) => {
    if (
      req.auth?.user.role === "STORE" &&
      !req.path.startsWith("/auth/") &&
      !req.path.startsWith("/stores")
    )
      await requireStore(db, req.auth.user);
    next();
  });
  registerIdentityRoutes(app, db, options);
  registerCatalogRoutes(app, db);
  registerShoppingRoutes(app, db, options);
  registerReportingRoutes(app, db);
  app.use("/api/ai", requireAuth, createAiRouter(db));
  app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found." }));
  const clientDirectory = resolve(process.cwd(), "dist/client");
  if (existsSync(clientDirectory)) {
    app.use(express.static(clientDirectory, { index: false }));
    app.get("/{*path}", (_req, res) => res.sendFile(resolve(clientDirectory, "index.html")));
  }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: "Check the submitted fields.",
        code: "VALIDATION_FAILED",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }
    if (error instanceof ApiError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    const databaseError = error as { code?: string; type?: string; status?: number };
    if (databaseError.code === "23505") {
      res.status(409).json({ error: "This email, SKU, or unique record already exists." });
      return;
    }
    if (databaseError.type === "entity.parse.failed") {
      res.status(400).json({ error: "The request body is not valid JSON." });
      return;
    }
    if (databaseError.type === "entity.too.large") {
      res.status(413).json({ error: "The request exceeds the upload limit." });
      return;
    }
    logger.error(
      {
        requestId: _req.requestId,
        code: databaseError.code,
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      "Request failed",
    );
    res.status(500).json({
      error: "The request could not be completed. Please try again.",
      requestId: _req.requestId,
    });
  });
  return app;
}
