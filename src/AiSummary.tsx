import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Paper } from "./types";
import {
  buildSummaryRequest,
  GOOGLE_WEB_CLIENT_ID,
  parseSummaryResponse,
  SUMMARY_API_URL,
  SUMMARY_FEATURE_CONFIGURED,
  type PaperSummary,
} from "./summaryApi";

type CredentialResponse = { credential?: string };
type GoogleIdentity = {
  accounts: {
    id: {
      initialize: (options: { client_id: string; callback: (response: CredentialResponse) => void; auto_select?: boolean }) => void;
      renderButton: (element: HTMLElement, options: Record<string, string>) => void;
      disableAutoSelect: () => void;
    };
  };
};

declare global {
  interface Window { google?: GoogleIdentity }
}

type SummaryAuthState = {
  configured: boolean;
  ready: boolean;
  credential: string | null;
  error: string | null;
  clearCredential: () => void;
};

const SummaryAuthContext = createContext<SummaryAuthState>({
  configured: false,
  ready: false,
  credential: null,
  error: null,
  clearCredential: () => undefined,
});

let googleScriptPromise: Promise<void> | null = null;

function loadGoogleIdentity(): Promise<void> {
  if (window.google) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;
  googleScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Google Sign-In could not load.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Sign-In could not load."));
    document.head.append(script);
  });
  return googleScriptPromise;
}

export function SummaryAuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [credential, setCredential] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!SUMMARY_FEATURE_CONFIGURED || !GOOGLE_WEB_CLIENT_ID) return;
    const clientId = GOOGLE_WEB_CLIENT_ID;
    let active = true;
    loadGoogleIdentity().then(() => {
      if (!active || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        auto_select: false,
        callback: (response) => {
          if (active && response.credential) {
            setCredential(response.credential);
            setError(null);
          }
        },
      });
      setReady(true);
    }).catch(() => { if (active) setError("Google Sign-In is unavailable. Try again later."); });
    return () => { active = false; };
  }, []);

  const value = useMemo<SummaryAuthState>(() => ({
    configured: SUMMARY_FEATURE_CONFIGURED,
    ready,
    credential,
    error,
    clearCredential: () => {
      window.google?.accounts.id.disableAutoSelect();
      setCredential(null);
    },
  }), [ready, credential, error]);

  return <SummaryAuthContext.Provider value={value}>{children}</SummaryAuthContext.Provider>;
}

function GoogleSignInButton() {
  const container = useRef<HTMLDivElement>(null);
  const { ready } = useContext(SummaryAuthContext);
  useEffect(() => {
    if (!ready || !container.current || !window.google) return;
    container.current.replaceChildren();
    window.google.accounts.id.renderButton(container.current, {
      type: "standard",
      theme: "outline",
      size: "medium",
      text: "signin_with",
      shape: "rectangular",
    });
  }, [ready]);
  return <div className="summary-signin" ref={container} aria-label="Sign in with Google to use AI summaries" />;
}

const summaryKey = (paper: Paper) => `chronicle-pdf-summary:${paper.doi || paper.id}`;
function base64FromBytes(bytes: Uint8Array) { let binary = ""; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)); return btoa(binary); }

export function AiSummary({ paper, pdf }: { paper: Paper; pdf: Blob | null }) {
  const auth = useContext(SummaryAuthContext);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PaperSummary | null>(() => { try { return parseSummaryResponse(JSON.parse(localStorage.getItem(summaryKey(paper)) || "null")); } catch { return null; } });
  const [request, setRequest] = useState<ReturnType<typeof buildSummaryRequest>>(null);

  useEffect(() => { let active = true; if (!pdf || pdf.size > 10 * 1024 * 1024) { setRequest(null); return; } void pdf.arrayBuffer().then((bytes) => { if (!active) return; setRequest(buildSummaryRequest(paper, base64FromBytes(new Uint8Array(bytes)))); }).catch(() => { if (active) setRequest(null); }); return () => { active = false; }; }, [paper, pdf]);

  if (!auth.configured || !SUMMARY_API_URL) return null;

  const generateSummary = async () => {
    if (!auth.credential || !request) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${SUMMARY_API_URL}/v1/summaries`, {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.credential}` },
        body: JSON.stringify(request),
      });
      if (response.status === 401 || response.status === 403) {
        auth.clearCredential();
        throw new Error("Your sign-in expired or this account is not authorized.");
      }
      if (response.status === 429) throw new Error("The summary limit has been reached. Try again later.");
      if (!response.ok) throw new Error("The protected summary service could not complete this request.");
      const parsed = parseSummaryResponse(await response.json());
      if (!parsed) throw new Error("The summary service returned an unexpected response.");
      setSummary(parsed);
      try { localStorage.setItem(summaryKey(paper), JSON.stringify(parsed)); } catch { /* The visible result remains available for this session. */ }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The summary could not be generated.");
    } finally {
      setLoading(false);
    }
  };

  return <div className="ai-summary">
    <button className="summary-button" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} disabled={!request} title={request ? undefined : "Upload a PDF of up to 10 MB before requesting a full-paper summary"}><span aria-hidden="true">✦</span>{request ? "AI summary" : "Upload PDF to summarize"}</button>
    {open && <section className="summary-panel" aria-label={`AI summary for ${paper.title}`}>
      <div className="summary-panel__heading"><div><p className="eyebrow">Optional Vertex AI summary</p><h3>Uploaded-paper research brief</h3></div>{auth.credential && <button type="button" onClick={auth.clearCredential}>Sign out</button>}</div>
      {!request ? <p className="summary-privacy">Attach a PDF of up to 10 MB in the Reading Room first. Chronicle sends the complete PDF only for this request; it never sends highlights or notes.</p> : !auth.credential ? <div className="summary-auth"><p>Sign in before any paid model request. Only explicitly authorized Google accounts can use this backend.</p>{auth.ready ? <GoogleSignInButton /> : <p className="summary-status">{auth.error || "Preparing secure sign-in…"}</p>}</div> : !summary ? <><p className="summary-privacy">Chronicle sends this complete PDF plus citation metadata to the protected backend for this request. The PDF is not retained by Chronicle.</p><button className="summary-generate" type="button" onClick={() => void generateSummary()} disabled={loading}>{loading ? "Generating securely…" : "Generate full-paper summary"}</button></> : <div className="summary-result"><p>{summary.summary}</p>{summary.keyPoints.length > 0 && <><h4>Key points</h4><ul>{summary.keyPoints.map((item) => <li key={item}>{item}</li>)}</ul></>}{summary.caveats.length > 0 && <><h4>Limits to verify</h4><ul>{summary.caveats.map((item) => <li key={item}>{item}</li>)}</ul></>}<p className="summary-disclaimer">AI-generated from the uploaded PDF with {summary.model}. Saved privately in this browser with the paper.</p><button className="summary-regenerate" type="button" onClick={() => void generateSummary()} disabled={loading}>{loading ? "Regenerating…" : "Regenerate"}</button></div>}
      {error && <p className="summary-error" role="alert">{error}</p>}
    </section>}
  </div>;
}
