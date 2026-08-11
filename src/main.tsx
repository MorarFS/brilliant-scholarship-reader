import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { SummaryAuthProvider } from "./AiSummary";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SummaryAuthProvider><App /></SummaryAuthProvider>
  </StrictMode>,
);
