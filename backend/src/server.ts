import { loadConfig } from "./config.js";
import { createRuntimeApp } from "./runtime.js";

const config = loadConfig();
const app = createRuntimeApp();

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`Chronicle summary API listening on port ${config.port}.`);
});

process.on("SIGTERM", () => server.close());
