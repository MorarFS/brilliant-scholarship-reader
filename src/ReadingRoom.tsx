import { useCallback, useEffect, useRef, useState } from "react";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import type { Annotation, Paper } from "./types";
import { citationToRis, formatCitation, normalizePdfSelectionRects, parseReadingLocation, stablePaperId } from "./readingRoomData";
import type { ReadingLocation } from "./readingRoomData";
import { loadLocalPdf, removeLocalPdf, saveLocalPdf } from "./localPdfStore";
import { AiSummary } from "./AiSummary";
import PdfDocumentView from "./PdfDocumentView";

type PdfSource = "open-access PDF" | "user-uploaded PDF";
type Props = {
  paper: Paper;
  annotations: Annotation[];
  onAddAnnotation: (annotation: Annotation) => void;
  onUpdateAnnotation: (id: string, note: string) => void;
  onDeleteAnnotation: (id: string) => void;
  onEnsureSaved: (paper: Paper) => void;
  onClose: () => void;
};


function safeId() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `annotation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function isPdf(blob: Blob) {
  const signature = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...signature) === "%PDF-";
}

function highlightedText(text: string, annotations: Annotation[]) {
  const matches = annotations.filter((item) => item.quote).map((item) => item.quote).sort((a, b) => b.length - a.length);
  let parts: Array<{ text: string; marked: boolean }> = [{ text, marked: false }];
  for (const quote of matches) {
    parts = parts.flatMap((part) => {
      if (part.marked) return [part];
      const index = part.text.indexOf(quote);
      if (index < 0) return [part];
      return [
        { text: part.text.slice(0, index), marked: false },
        { text: quote, marked: true },
        { text: part.text.slice(index + quote.length), marked: false },
      ].filter((item) => item.text);
    });
  }
  return parts.map((part, index) => part.marked ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>);
}

function downloadText(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function ReadingRoom({ paper, annotations, onAddAnnotation, onUpdateAnnotation, onDeleteAnnotation, onEnsureSaved, onClose }: Props) {
  const paperId = stablePaperId(paper);
  const citation = formatCitation(paper);
  const [pages, setPages] = useState<string[]>([]);
  const [pageDimensions, setPageDimensions] = useState<Array<{ width: number; height: number }>>([]);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [summaryPdf, setSummaryPdf] = useState<Blob | null>(null);
  const [documentSource, setDocumentSource] = useState<PdfSource | null>(null);
  const [localFileName, setLocalFileName] = useState<string | null>(null);
  const [readerState, setReaderState] = useState<"loading" | "ready" | "fallback">("loading");
  const [readerMessage, setReaderMessage] = useState("Preparing the legally available reading copy…");
  const [mode, setMode] = useState<"text" | "pdf">("text");
  const [draftQuote, setDraftQuote] = useState("");
  const [draftPage, setDraftPage] = useState<number | null>(null);
  const [draftAnchor, setDraftAnchor] = useState<Annotation["anchor"]>();
  const [draftNote, setDraftNote] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [speechText, setSpeechText] = useState("");
  const [speechState, setSpeechState] = useState<"idle" | "playing" | "paused">("idle");
  const [speechRate, setSpeechRate] = useState(1);
  const textPaneRef = useRef<HTMLDivElement>(null);
  const pdfPaneRef = useRef<HTMLDivElement>(null);
  const readerDocumentRef = useRef<HTMLElement>(null);
  const pdfLoadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const pendingRestoreRef = useRef<ReadingLocation | null>(null);
  const readingLocationRef = useRef<ReadingLocation>(({ page: 1, offset: 0 }));
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const locationStorageKey = `chronicle-reading-location:v1:${paperId}`;

  const storeReadingLocation = useCallback((location: ReadingLocation) => {
    readingLocationRef.current = location;
    try { localStorage.setItem(locationStorageKey, JSON.stringify(location)); } catch { /* Reading can continue without position persistence. */ }
  }, [locationStorageKey]);

  const currentReadingLocation = useCallback((): ReadingLocation => {
    const container = readerDocumentRef.current;
    if (!container) return readingLocationRef.current;
    const containerTop = container.getBoundingClientRect().top;
    const threshold = containerTop + 16;
    const pageElements = [...container.querySelectorAll<HTMLElement>("[data-reader-page]")];
    if (!pageElements.length) return readingLocationRef.current;
    let current = pageElements[0];
    for (const page of pageElements) {
      if (page.getBoundingClientRect().top <= threshold) current = page;
      else break;
    }
    const rect = current.getBoundingClientRect();
    return {
      page: Math.max(1, Number(current.dataset.readerPage) || 1),
      offset: rect.height > 0 ? Math.min(1, Math.max(0, (threshold - rect.top) / rect.height)) : 0,
    };
  }, []);

  const restoreReadingLocation = useCallback((location: ReadingLocation) => {
    const container = readerDocumentRef.current;
    const page = container?.querySelector<HTMLElement>(`[data-reader-page="${location.page}"]`);
    if (!container || !page) return false;
    const containerRect = container.getBoundingClientRect();
    const pageRect = page.getBoundingClientRect();
    container.scrollTop += pageRect.top - containerRect.top + (pageRect.height * location.offset) - 16;
    return true;
  }, []);

  const closeReader = useCallback(() => {
    storeReadingLocation(currentReadingLocation());
    onClose();
  }, [currentReadingLocation, onClose, storeReadingLocation]);

  const openBlob = useCallback(async (blob: Blob, source: PdfSource, filename?: string) => {
    if (!(await isPdf(blob))) throw new Error("The selected content is not a PDF file.");
    setReaderState("loading");
    setReaderMessage("Extracting selectable text locally in your browser…");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
    const loadingTask = pdfjs.getDocument({ data: bytes });
    const document = await loadingTask.promise;
    const extracted: string[] = [];
    const dimensions: Array<{ width: number; height: number }> = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      dimensions.push({ width: viewport.width, height: viewport.height });
      const content = await page.getTextContent();
      const text = content.items.map((item) => "str" in item ? `${item.str}${"hasEOL" in item && item.hasEOL ? "\n" : " "}` : "").join("").replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").trim();
      extracted.push(text);
    }
    void pdfLoadingTaskRef.current?.destroy();
    pdfLoadingTaskRef.current = loadingTask;
    setPages(extracted);
    setPageDimensions(dimensions);
    setPdfDocument(document);
    setDocumentSource(source);
    setSummaryPdf(source === "user-uploaded PDF" ? blob : null);
    setLocalFileName(filename || null);
    setReaderState("ready");
    setReaderMessage(`${document.numPages} pages ready. PDF rendering, text extraction, and annotations stay in this browser.`);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const prepare = async () => {
      try {
        const localPdf = await loadLocalPdf(paperId);
        if (cancelled) return;
        if (localPdf) {
          await openBlob(localPdf.blob, "user-uploaded PDF", localPdf.name);
          return;
        }
      } catch {
        // IndexedDB may be unavailable; the OA attempt or upload control remains usable.
      }
      if (!paper.openAccessPdfUrl) {
        if (!cancelled) {
          setReaderState("fallback");
          setReaderMessage(paper.openAccessUrl ? "The open-access location is not identified as a direct PDF. Use the source site, or attach a PDF obtained legally." : "No legal open-access PDF is listed in the current metadata. You can still keep citation notes or attach a PDF obtained legally.");
        }
        return;
      }
      try {
        const response = await fetch(paper.openAccessPdfUrl, { mode: "cors", credentials: "omit" });
        if (!response.ok) throw new Error(`Source returned ${response.status}`);
        const blob = await response.blob();
        if (cancelled) return;
        await openBlob(blob, "open-access PDF");
      } catch {
        if (!cancelled) {
          setReaderState("fallback");
          setReaderMessage("The legal OA copy could not be embedded—usually because the source blocks cross-site requests or returned a landing page instead of a PDF. Brilliant will not bypass that restriction.");
        }
      }
    };
    void prepare();
    return () => { cancelled = true; };
  }, [openBlob, paper.openAccessPdfUrl, paper.openAccessUrl, paperId]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") closeReader(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", closeOnEscape); };
  }, [closeReader]);

  useEffect(() => {
    try {
      const saved = parseReadingLocation(JSON.parse(localStorage.getItem(locationStorageKey) || "null"));
      if (saved) readingLocationRef.current = saved;
    } catch { /* Start at page one if the saved position is unavailable or malformed. */ }
    pendingRestoreRef.current = readingLocationRef.current;
  }, [locationStorageKey]);

  useEffect(() => {
    if (readerState !== "ready") return;
    const frame = window.requestAnimationFrame(() => {
      const location = pendingRestoreRef.current || readingLocationRef.current;
      if (restoreReadingLocation(location)) pendingRestoreRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mode, pageDimensions.length, readerState, restoreReadingLocation]);

  useEffect(() => {
    const container = readerDocumentRef.current;
    if (!container || readerState !== "ready") return;
    let frame = 0;
    const remember = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => storeReadingLocation(currentReadingLocation()));
    };
    container.addEventListener("scroll", remember, { passive: true });
    return () => {
      container.removeEventListener("scroll", remember);
      window.cancelAnimationFrame(frame);
      storeReadingLocation(currentReadingLocation());
    };
  }, [currentReadingLocation, mode, readerState, storeReadingLocation]);

  useEffect(() => () => { void pdfLoadingTaskRef.current?.destroy(); }, []);
  useEffect(() => () => { window.speechSynthesis?.cancel(); }, []);

  const switchMode = (nextMode: "text" | "pdf") => {
    if (nextMode === mode) return;
    const location = currentReadingLocation();
    storeReadingLocation(location);
    pendingRestoreRef.current = location;
    setMode(nextMode);
  };

  const captureSelection = () => {
    const selection = window.getSelection();
    const quote = selection?.toString().trim() || "";
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const scope = mode === "pdf" ? pdfPaneRef.current : textPaneRef.current;
    if (!quote || !range || !scope?.contains(range.startContainer) || !scope.contains(range.endContainer)) {
      setActionStatus(`Select text in the ${mode === "pdf" ? "PDF" : "extracted-text"} view first, then choose Highlight selection.`);
      return;
    }
    const startElement = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const endElement = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;
    const pageElement = startElement?.closest<HTMLElement>("[data-reader-page]");
    const endPageElement = endElement?.closest<HTMLElement>("[data-reader-page]");
    if (!pageElement || pageElement !== endPageElement) {
      setActionStatus("Select a passage within one page so Brilliant can preserve a precise page anchor.");
      return;
    }
    const page = Math.max(1, Number(pageElement.dataset.readerPage) || 1);
    let anchor: Annotation["anchor"];
    if (mode === "pdf") {
      const rects = normalizePdfSelectionRects(pageElement.getBoundingClientRect(), [...range.getClientRects()]);
      if (!rects.length) {
        setActionStatus("The browser could not locate that PDF selection. Try selecting the passage again.");
        return;
      }
      anchor = { kind: "pdf", page, quote: quote.slice(0, 12000), rects };
    }
    setDraftQuote(quote.slice(0, 12000));
    setDraftPage(page);
    setDraftAnchor(anchor);
    setActionStatus(mode === "pdf" ? "PDF selection captured with its page and highlight geometry. Add an optional note, then save." : "Selection captured. Add an optional note, then save the annotation.");
  };

  const readSelection = () => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() || "";
    const scope = mode === "pdf" ? pdfPaneRef.current : textPaneRef.current;
    if (!text || !scope?.contains(selection?.anchorNode || null)) { setActionStatus(`Select text in the ${mode === "pdf" ? "PDF" : "extracted-text"} view first, then choose Read selection aloud.`); return; }
    if (!("speechSynthesis" in window)) { setActionStatus("Text-to-speech is unavailable in this browser."); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 12_000));
    utterance.lang = "en-US";
    utterance.rate = speechRate;
    utterance.onend = () => setSpeechState("idle");
    utterance.onerror = () => { setSpeechState("idle"); setActionStatus("Speech playback could not start."); };
    setSpeechText(text);
    setSpeechState("playing");
    window.speechSynthesis.speak(utterance);
    setActionStatus("Reading the selected passage aloud on this device.");
  };

  const toggleSpeech = () => {
    if (speechState === "playing") { window.speechSynthesis.pause(); setSpeechState("paused"); }
    else if (speechState === "paused") { window.speechSynthesis.resume(); setSpeechState("playing"); }
  };
  const stopSpeech = () => { window.speechSynthesis?.cancel(); setSpeechState("idle"); setSpeechText(""); };

  const saveAnnotation = () => {
    const note = draftNote.trim();
    if (!draftQuote && !note) {
      setActionStatus("Add a note or capture a passage before saving.");
      return;
    }
    const now = new Date().toISOString();
    onEnsureSaved(paper);
    onAddAnnotation({ id: safeId(), paperId, citation, quote: draftQuote, note, page: draftPage, ...(draftAnchor ? { anchor: draftAnchor } : {}), source: documentSource || "citation only", createdAt: now, updatedAt: now });
    setDraftQuote("");
    setDraftPage(null);
    setDraftAnchor(undefined);
    setDraftNote("");
    window.getSelection()?.removeAllRanges();
    setActionStatus(draftAnchor ? "PDF highlight and note saved locally with a durable page anchor." : "Annotation saved locally with the paper and citation.");
  };

  const uploadPdf = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (!(await isPdf(file))) throw new Error("not PDF");
      let persisted = true;
      try { await saveLocalPdf(paperId, file); } catch { persisted = false; }
      await openBlob(file, "user-uploaded PDF", file.name);
      onEnsureSaved(paper);
      setActionStatus(persisted ? `Attached ${file.name} to this paper in private browser storage.` : `${file.name} is open for this session, but this browser could not retain it; reattach it after closing.`);
    } catch {
      setActionStatus("That file is not a readable PDF. No file was uploaded or stored.");
    }
  };

  const forgetLocalPdf = async () => {
    try { await removeLocalPdf(paperId); } catch { /* The current in-memory copy can still be closed safely. */ }
    setActionStatus("The retained local PDF was removed. It remains open only until this Reading Room closes.");
  };

  const copyCitation = async () => {
    try { await navigator.clipboard.writeText(citation); setActionStatus("Citation copied."); } catch { setActionStatus("Clipboard access was blocked; select and copy the citation shown above."); }
  };

  const downloadNotes = () => {
    let summary = "";
    try {
      const value = JSON.parse(localStorage.getItem(`chronicle-pdf-summary:${paper.doi || paper.id}`) || "null") as { summary?: string; keyPoints?: string[]; caveats?: string[] } | null;
      if (value?.summary) summary = `\n## AI summary\n\n${value.summary}\n${value.keyPoints?.length ? `\n### Key points\n${value.keyPoints.map((item) => `- ${item}`).join("\n")}\n` : ""}${value.caveats?.length ? `\n### Limits to verify\n${value.caveats.map((item) => `- ${item}`).join("\n")}\n` : ""}`;
    } catch { /* Export the notes even if a saved summary is malformed. */ }
    const notes = annotations.length ? annotations.map((item, index) => `### Note ${index + 1}${item.page ? ` · page ${item.page}` : ""}\n\n${item.quote ? `> ${item.quote.replace(/\n/g, "\n> ")}\n\n` : ""}${item.note || "_No note text._"}`).join("\n\n") : "_No highlights or notes saved._";
    downloadText(`${paper.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`, `# ${paper.title}\n\n## Citation\n\n${citation}\n${summary}\n## Highlights and notes\n\n${notes}\n`, "text/markdown;charset=utf-8");
    setActionStatus("Downloaded a Markdown research note with citation, summary, highlights, and notes.");
  };

  return <div className="reading-room" role="dialog" aria-modal="true" aria-labelledby="reading-room-title">
    <header className="reading-room__header"><div><p className="eyebrow">Brilliant Reading Room</p><h1 id="reading-room-title">{paper.title}</h1><p>{citation}</p><div className="reader-source-row"><span>{documentSource || "citation only"}</span>{localFileName && <span>{localFileName}</span>}<span>{annotations.length} {annotations.length === 1 ? "annotation" : "annotations"}</span></div></div><button ref={closeButtonRef} className="reader-close" type="button" onClick={closeReader} aria-label="Close Reading Room">×</button></header>
    <div className="reading-room__toolbar"><div>{readerState === "ready" && <><button className={mode === "text" ? "is-active" : ""} type="button" onClick={() => switchMode("text")}>Selectable text</button><button className={mode === "pdf" ? "is-active" : ""} type="button" onClick={() => switchMode("pdf")}>Original PDF</button></>}<button type="button" onClick={copyCitation}>Copy citation</button><button type="button" onClick={downloadNotes}>Download notes (.md)</button><button type="button" onClick={() => downloadText(`${paper.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ris`, citationToRis(paper), "application/x-research-info-systems")}>Export RIS</button></div><div><label className="reader-upload">Upload PDF<input className="sr-only" type="file" accept="application/pdf,.pdf" onChange={(event) => { void uploadPdf(event.target.files?.[0]); event.target.value = ""; }} /></label>{documentSource === "user-uploaded PDF" && <button type="button" onClick={() => void forgetLocalPdf()}>Forget local PDF</button>}{paper.openAccessUrl && <a href={paper.openAccessUrl} target="_blank" rel="noreferrer">Open OA source ↗</a>}</div></div>
    <div className="reading-room__workspace"><main className="reader-document" ref={readerDocumentRef} aria-label="Paper content">
      <div className={`reader-notice reader-notice--${readerState}`} role="status"><strong>{readerState === "ready" ? "Reading copy ready" : readerState === "loading" ? "Preparing reading copy" : "Citation and notes mode"}</strong><p>{readerMessage}</p></div>
      {readerState === "loading" && <div className="reader-loading" aria-hidden="true" />}
      {readerState === "fallback" && <section className="reader-fallback"><h2>The source must stay outside Brilliant.</h2><p>Publisher access rules and browser CORS protections are respected. Open the source in a new tab, or use <strong>Upload PDF</strong> above to attach a copy you obtained legally through your library or proxy. The file is processed locally and is never sent to Brilliant.</p></section>}
      {readerState === "ready" && <><div className="reader-selection-tools"><p>Select a passage in the {mode === "pdf" ? "PDF" : "extracted text"}, then highlight or hear it.</p><div><button type="button" onClick={captureSelection}>Highlight selection</button><button type="button" onClick={readSelection}>Read selection aloud</button><label className="speech-rate">Speed<select value={speechRate} onChange={(event) => setSpeechRate(Number(event.target.value))}><option value="0.75">0.75×</option><option value="0.9">0.9×</option><option value="1">1×</option><option value="1.15">1.15×</option><option value="1.3">1.3×</option><option value="1.5">1.5×</option><option value="1.7">1.7×</option></select></label>{speechState !== "idle" && <><button type="button" onClick={toggleSpeech}>{speechState === "playing" ? "Pause" : "Resume"}</button><button type="button" onClick={stopSpeech}>Stop</button></>}</div></div>{speechText && <p className="reader-speech-status">Speaking selection locally in your browser at {speechRate}×.</p>}<div className="reader-summary reader-summary--document"><AiSummary paper={paper} pdf={summaryPdf} /></div>{mode === "text" && <div className="reader-pages" ref={textPaneRef}>{pages.map((page, index) => <article className="reader-page" data-reader-page={index + 1} key={index}><p className="eyebrow">Page {index + 1}</p><div>{highlightedText(page, annotations.filter((item) => item.page === index + 1))}</div></article>)}</div>}{mode === "pdf" && pdfDocument && <PdfDocumentView document={pdfDocument} pageDimensions={pageDimensions} annotations={annotations} paneRef={pdfPaneRef} />}</>}
    </main>
    <aside className="annotation-panel" aria-label="Notes and highlights"><div className="annotation-compose"><p className="eyebrow">New annotation</p>{draftQuote ? <blockquote><span>Selected{draftPage ? ` · page ${draftPage}` : ""}{draftAnchor ? " · PDF anchor" : ""}</span>{draftQuote}</blockquote> : <p className="annotation-compose__hint">Capture a passage in either reading view, or add a paper-level note without a highlight.</p>}<label>Note<textarea value={draftNote} onChange={(event) => setDraftNote(event.target.value)} rows={4} placeholder="Why does this passage matter?" /></label><button type="button" onClick={saveAnnotation}>Save annotation</button><p className="reader-action-status" aria-live="polite">{actionStatus}</p></div>
      <div className="annotation-list"><div><p className="eyebrow">Research record</p><h2>{annotations.length} saved</h2></div>{annotations.length ? annotations.map((annotation) => <article key={annotation.id}><div className="annotation-meta"><span>{annotation.source}</span><span>{annotation.page ? `Page ${annotation.page}` : "Paper note"}</span><time dateTime={annotation.updatedAt}>{new Date(annotation.updatedAt).toLocaleDateString()}</time></div>{annotation.quote && <blockquote>{annotation.quote}</blockquote>}<label>Note<textarea value={annotation.note} onChange={(event) => onUpdateAnnotation(annotation.id, event.target.value)} rows={3} /></label><p className="annotation-citation"><strong>Citation</strong>{annotation.citation}</p><button type="button" onClick={() => onDeleteAnnotation(annotation.id)}>Delete annotation</button></article>) : <div className="annotation-empty"><span aria-hidden="true">✦</span><p>No annotations yet. Select a passage or add a paper-level note.</p></div>}</div>
    </aside></div>
  </div>;
}
