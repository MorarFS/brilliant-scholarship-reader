import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { RuntimeConfig, SummaryResult } from "./types.js";

const config: RuntimeConfig = {
  project: "test-project",
  location: "global",
  model: "test-model",
  googleWebClientId: "1234-test.apps.googleusercontent.com",
  allowedEmails: new Set(["reader@example.com"]),
  allowedOrigins: new Set(["https://morarfs.github.io"]),
  maxRequestsPerUserPerHour: 1,
  port: 8080,
};
const paper = { paper: { id: "10.1234/example", title: "Archive methods", authors: ["A. Scholar"], publicationDate: "2026-01-02", journal: "DH Journal", doi: "10.1234/example", extractedText: "Extracted paper text about computational analysis of historical archival evidence. ".repeat(20) } };
const result: SummaryResult = { summary: "Brief", keyPoints: ["Point"], caveats: ["Extraction may be imperfect."], model: "test-model", generatedAt: "2026-08-11T00:00:00Z" };

describe("summary API security boundary", () => {
  it("rejects requests before the summarizer when authentication is missing", async () => {
    const summarize = vi.fn(async () => result);
    const app = createApp(config, async () => ({ subject: "reader", email: "reader@example.com" }), summarize);
    await request(app).post("/v1/summaries").set("Origin", "https://morarfs.github.io").send(paper).expect(401);
    expect(summarize).not.toHaveBeenCalled();
  });

  it("rejects an unapproved browser origin", async () => {
    const summarize = vi.fn(async () => result);
    const app = createApp(config, async () => ({ subject: "reader", email: "reader@example.com" }), summarize);
    await request(app).post("/v1/summaries").set("Origin", "https://attacker.example").set("Authorization", "Bearer valid").send(paper).expect(403);
    expect(summarize).not.toHaveBeenCalled();
  });

  it("summarizes bounded uploaded-paper text only for a verified user", async () => {
    const summarize = vi.fn(async () => result);
    const app = createApp(config, async () => ({ subject: "reader", email: "reader@example.com" }), summarize);
    const response = await request(app).post("/v1/summaries").set("Origin", "https://morarfs.github.io").set("Authorization", "Bearer valid").send(paper).expect(200);
    expect(response.body.summary).toBe("Brief");
    expect(summarize).toHaveBeenCalledWith({ ...paper.paper, extractedText: paper.paper.extractedText.trim() });
  });

  it("rate-limits an authenticated subject before a second Vertex call", async () => {
    const summarize = vi.fn(async () => result);
    const app = createApp(config, async () => ({ subject: "same-reader", email: "reader@example.com" }), summarize);
    const call = () => request(app).post("/v1/summaries").set("Origin", "https://morarfs.github.io").set("Authorization", "Bearer valid").send(paper);
    await call().expect(200);
    await call().expect(429);
    expect(summarize).toHaveBeenCalledTimes(1);
  });
});
