import { createApp } from "./app.js";
import { createGoogleTokenVerifier } from "./auth.js";
import { loadConfig } from "./config.js";
import { createVertexSummarizer } from "./vertex.js";

export function createRuntimeApp(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);
  return createApp(
    config,
    createGoogleTokenVerifier(config.googleWebClientId, config.allowedEmails),
    createVertexSummarizer(config.project, config.location, config.model),
  );
}
