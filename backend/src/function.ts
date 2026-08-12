import { createRuntimeApp } from "./runtime.js";

// Cloud Run functions invokes this Express-compatible handler. Authentication,
// allowlisting, CORS, input bounds, and Vertex access remain inside the app.
export const chronicleSummaryApi = createRuntimeApp();
