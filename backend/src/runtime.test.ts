import request from "supertest";
import { describe, expect, it } from "vitest";
import { createRuntimeApp } from "./runtime.js";

describe("deployable runtime", () => {
  it("exports the same public health route without invoking Vertex", async () => {
    const app = createRuntimeApp({
      GOOGLE_CLOUD_PROJECT: "test-project",
      GOOGLE_CLOUD_LOCATION: "global",
      VERTEX_MODEL: "gemini-2.5-flash",
      GOOGLE_WEB_CLIENT_ID: "123456-test.apps.googleusercontent.com",
      ALLOWED_EMAILS: "reader@example.com",
      ALLOWED_ORIGINS: "https://morarfs.github.io",
    });
    const response = await request(app).get("/healthz");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});
