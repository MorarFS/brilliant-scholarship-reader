import express, { type Request, type Response } from "express";
import { parsePaperInput } from "./input.js";
import { createRateLimiter } from "./rateLimit.js";
import type { RuntimeConfig, SummarizePaper, VerifyUser } from "./types.js";

function bearerToken(request: Request): string | null {
  const authorization = request.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  return token && token.length <= 8_192 ? token : null;
}

export function createApp(config: RuntimeConfig, verifyUser: VerifyUser, summarize: SummarizePaper) {
  const app = express();
  const limiter = createRateLimiter(config.maxRequestsPerUserPerHour);

  app.disable("x-powered-by");
  app.use((request, response, next) => {
    response.set({
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    const origin = request.get("origin");
    if (origin) {
      if (!config.allowedOrigins.has(origin)) { response.status(403).json({ error: "Origin is not allowed." }); return; }
      response.set({
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin",
      });
    }
    if (request.method === "OPTIONS") { response.sendStatus(204); return; }
    next();
  });
  app.use(express.json({ limit: "16mb", strict: true }));

  app.get("/healthz", (_request, response) => response.json({ status: "ok" }));

  app.post("/v1/summaries", async (request: Request, response: Response) => {
    const token = bearerToken(request);
    if (!token) { response.status(401).json({ error: "Authentication is required." }); return; }
    let user;
    try { user = await verifyUser(token); }
    catch { response.status(401).json({ error: "Authentication failed." }); return; }
    if (!limiter.allow(user.subject)) { response.status(429).json({ error: "Summary limit reached." }); return; }
    const paper = parsePaperInput(request.body);
    if (!paper) { response.status(400).json({ error: "A valid PDF summary request is required." }); return; }
    try {
      response.json(await summarize(paper));
    } catch (error) {
      // Keep the browser response generic, but preserve a sanitized diagnostic for operators.
      console.error("Vertex summary failed", error instanceof Error ? error.message.slice(0, 500) : "unknown error");
      response.status(502).json({ error: "The summary could not be generated." });
    }
  });

  app.use((_request, response) => response.status(404).json({ error: "Not found." }));
  return app;
}
