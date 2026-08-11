import type { RuntimeConfig } from "./types.js";

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (!value) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${name} must be a positive integer.`);
  return number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS is forbidden. Attach a user-managed Cloud Run service account instead of a key file.");
  }
  const googleWebClientId = required(env, "GOOGLE_WEB_CLIENT_ID");
  if (!/^[0-9]+-[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(googleWebClientId)) throw new Error("GOOGLE_WEB_CLIENT_ID is not a valid web client ID.");
  const allowedEmails = new Set(required(env, "ALLOWED_EMAILS").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  if (!allowedEmails.size) throw new Error("ALLOWED_EMAILS must contain at least one account.");
  const allowedOrigins = new Set(required(env, "ALLOWED_ORIGINS").split(",").map((value) => {
    const url = new URL(value.trim());
    const localDevelopment = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (url.protocol !== "https:" && !localDevelopment) throw new Error("ALLOWED_ORIGINS must use HTTPS except for localhost.");
    return url.origin;
  }));
  return {
    project: required(env, "GOOGLE_CLOUD_PROJECT"),
    location: env.GOOGLE_CLOUD_LOCATION?.trim() || "global",
    model: env.VERTEX_MODEL?.trim() || "gemini-2.5-flash",
    googleWebClientId,
    allowedEmails,
    allowedOrigins,
    maxRequestsPerUserPerHour: positiveInteger(env.MAX_REQUESTS_PER_USER_PER_HOUR, 20, "MAX_REQUESTS_PER_USER_PER_HOUR"),
    port: positiveInteger(env.PORT, 8080, "PORT"),
  };
}
