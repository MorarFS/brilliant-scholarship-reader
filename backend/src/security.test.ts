import { describe, expect, it } from "vitest";
import { authorizePayload } from "./auth.js";
import { loadConfig } from "./config.js";
import { parsePaperInput } from "./input.js";
import { parseModelOutput } from "./vertex.js";

const baseEnv = {
  GOOGLE_CLOUD_PROJECT: "project-id",
  GOOGLE_WEB_CLIENT_ID: "1234-example.apps.googleusercontent.com",
  ALLOWED_EMAILS: "reader@example.com",
  ALLOWED_ORIGINS: "https://morarfs.github.io,http://localhost:5173",
};

describe("backend validation", () => {
  it("fails closed on key-file credentials and missing allowlists", () => {
    expect(() => loadConfig({ ...baseEnv, GOOGLE_APPLICATION_CREDENTIALS: "/tmp/key.json" })).toThrow(/forbidden/i);
    expect(() => loadConfig({ ...baseEnv, ALLOWED_EMAILS: "" })).toThrow(/required/i);
  });

  it("requires a verified explicitly allowed Google identity", () => {
    expect(authorizePayload({ sub: "123", email: "reader@example.com", email_verified: true } as never, new Set(["reader@example.com"]))).toEqual({ subject: "123", email: "reader@example.com" });
    expect(() => authorizePayload({ sub: "123", email: "other@example.com", email_verified: true } as never, new Set(["reader@example.com"]))).toThrow(/not authorized/i);
  });

  it("accepts only the bounded paper metadata contract", () => {
    const pdfBase64 = "A".repeat(1_000);
    expect(parsePaperInput({ paper: { id: "id", title: "Title", authors: [], publicationDate: "2026-01-02", journal: "Journal", doi: null, pdfBase64 } })?.title).toBe("Title");
    expect(parsePaperInput({ paper: { id: "id", title: "Title", authors: [], publicationDate: "bad", journal: "Journal", doi: null, pdfBase64 } })).toBeNull();
  });

  it("validates structured model output", () => {
    expect(parseModelOutput('{"summary":"Brief","keyPoints":["One"],"sections":[{"heading":"Methods","summary":"Summary"}],"caveats":["PDF may be incomplete"]}', "model", "now").model).toBe("model");
    expect(parseModelOutput('```json\n{"summary":"Brief"}\n```', "model")).toMatchObject({ summary: "Brief", keyPoints: [], sections: [], caveats: [] });
  });
});
