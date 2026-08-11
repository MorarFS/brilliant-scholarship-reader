import { createApp } from "./app.js";
import { createGoogleTokenVerifier } from "./auth.js";
import { loadConfig } from "./config.js";
import { createVertexSummarizer } from "./vertex.js";

const config = loadConfig();
const app = createApp(
  config,
  createGoogleTokenVerifier(config.googleWebClientId, config.allowedEmails),
  createVertexSummarizer(config.project, config.location, config.model),
);

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`Chronicle summary API listening on port ${config.port}.`);
});

process.on("SIGTERM", () => server.close());
