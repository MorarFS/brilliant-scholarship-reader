import { useCallback, useEffect, useRef, useState } from "react";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import type { Annotation, Paper } from "./types";
import { citationToRis, commitLocalAnnotation, formatCitation, hasSelectablePdfText, normalizePdfSelectionRects, parseReadingLocation, stablePaperId } from "./readingRoomData";
import type { ReadingLocation } from "./readingRoomData";
import { loadLocalPdf, removeLocalPdf, saveLocalPdf } from "./localPdfStore";
import { AiSummary } from "./AiSummary";
import PdfDocumentView from "./PdfDocumentView";

type PdfSource = "open-access PDF" | "user-uploaded PDF";
type CapturedPassage = Pick<Annotation, "quote" | "page" | "anchor">;
type SelectionStatus = { tone: "ready" | "success" | "error"; message: string };
type SelectionCapture = { passage: CapturedPassage; error?: never; useRemembered?: never } | { passage?: never; error: string; useRemembered: boolean };
type Props = {
  paper: Paper;
  annotations: Annotation[];
  onAddAnnotation: (annotation: Annotation) => boolean;
  onUpdateAnnotation: (id: string, note: string) => boolean;
  onDeleteAnnotation: (id: string) => void;
  onEnsureSaved: (paper: Paper) => boolean;
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
  const readerRelease = "2026.08.17.2";
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
  const [draftNote, setDraftNote] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [selectionStatus, setSelectionStatus] = useState<SelectionStatus | null>(null);
  const [capturedPassage, setCapturedPassage] = useState<CapturedPassage | null>(null);
  const [lastSavedAnnotationId, setLastSavedAnnotationId] = useState<string | null>(null);
  const [noteStatuses, setNoteStatuses] = useState<Record<string, SelectionStatus>>({});
  const [speechText, setSpeechText] = useState("");
  const [speechState, setSpeechState] = useState<"idle" | "playing" | "paused">("idle");
  const [speechRate, setSpeechRate] = useState(1);
  const textPaneRef = useRef<HTMLDivElement>(null);
  const pdfPaneRef = useRef<HTMLDivElement>(null);
  const readerDocumentRef = useRef<HTMLElement>(null);
  const pdfLoadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const pendingRestoreRef = useRef<ReadingLocation | null>(null);
  const readingLocationRef = useRef<ReadingLocation>(({ page: 1, offset: 0 }));
  const lastSelectedPassageRef = useRef<CapturedPassage | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const locationStorageKey = `chronicle-reading-location:v1:${paperId}`;
  const selectableTextAvailable = hasSelectablePdfText(pages);

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
    lastSelectedPassageRef.current = null;
    setCapturedPassage(null);
    setSelectionStatus(null);
    setMode(nextMode);
  };

  const readSelectionCapture = useCallback((): SelectionCapture => {
    if (!selectableTextAvailable) {
      return { error: "This PDF has no selectable text layer. Attach an OCR-enabled PDF or add a paper note instead.", useRemembered: false };
    }
    const selection = window.getSelection();
    const quote = selection?.toString().trim() || "";
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const scope = mode === "pdf" ? pdfPaneRef.current : textPaneRef.current;
    if (!quote || !range || !scope?.contains(range.startContainer) || !scope.contains(range.endContainer)) {
      return { error: `No passage was detected. Select text in the ${mode === "pdf" ? "PDF" : "extracted-text"} view, then choose Save highlight.`, useRemembered: true };
    }
    const startElement = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const endElement = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;
    const pageElement = startElement?.closest<HTMLElement>("[data-reader-page]");
    const endPageElement = endElement?.closest<HTMLElement>("[data-reader-page]");
    if (!pageElement || pageElement !== endPageElement) {
      return { error: "Select a passage within one page so Brilliant can preserve a precise page anchor.", useRemembered: false };
    }
    const page = Math.max(1, Number(pageElement.dataset.readerPage) || 1);
    let anchor: Annotation["anchor"];
    if (mode === "pdf") {
      const rects = normalizePdfSelectionRects(pageElement.getBoundingClientRect(), [...range.getClientRects()]);
      if (!rects.length) {
        return { error: "Brilliant could not locate that PDF selection. Select the passage again within one page.", useRemembered: false };
      }
      anchor = { kind: "pdf", page, quote: quote.slice(0, 12000), rects };
    }
    return { passage: { quote: quote.slice(0, 12000), page, ...(anchor ? { anchor } : {}) } };
  }, [mode, selectableTextAvailable]);

  const rememberPassage = useCallback((passage: CapturedPassage, fallback = false) => {
    lastSelectedPassageRef.current = passage;
    setCapturedPassage(passage);
    const compactQuote = passage.quote.replace(/\s+/g, " ");
    const preview = compactQuote.slice(0, 150);
    setSelectionStatus({
      tone: "ready",
      message: `${fallback ? "Line" : "Selection"} ready on page ${passage.page}: “${preview}${compactQuote.length > 150 ? "…" : ""}” Choose Save highlight.`,
    });
  }, []);

  const passageFromPdfTextSpan = useCallback((target: EventTarget | null): CapturedPassage | null => {
    if (mode !== "pdf" || !(target instanceof Element)) return null;
    const span = target.closest<HTMLElement>(".textLayer span");
    const pageElement = span?.closest<HTMLElement>("[data-reader-page]");
    const quote = span?.textContent?.trim() || "";
    if (!span || !pageElement || !quote) return null;
    const page = Math.max(1, Number(pageElement.dataset.readerPage) || 1);
    const rects = normalizePdfSelectionRects(pageElement.getBoundingClientRect(), [span.getBoundingClientRect()]);
    if (!rects.length) return null;
    const clippedQuote = quote.slice(0, 12000);
    return { quote: clippedQuote, page, anchor: { kind: "pdf", page, quote: clippedQuote, rects } };
  }, [mode]);

  useEffect(() => {
    lastSelectedPassageRef.current = null;
    const rememberValidSelection = () => {
      const capture = readSelectionCapture();
      if (capture.passage) rememberPassage(capture.passage);
    };
    const scope = mode === "pdf" ? pdfPaneRef.current : textPaneRef.current;
    const rememberPointerSelection = (event: PointerEvent) => {
      const capture = readSelectionCapture();
      if (capture.passage) rememberPassage(capture.passage);
      else {
        const fallback = passageFromPdfTextSpan(event.target);
        if (fallback) rememberPassage(fallback, true);
      }
      window.requestAnimationFrame(rememberValidSelection);
    };
    document.addEventListener("selectionchange", rememberValidSelection);
    scope?.addEventListener("pointerup", rememberPointerSelection);
    scope?.addEventListener("keyup", rememberValidSelection);
    return () => {
      document.removeEventListener("selectionchange", rememberValidSelection);
      scope?.removeEventListener("pointerup", rememberPointerSelection);
      scope?.removeEventListener("keyup", rememberValidSelection);
    };
  }, [mode, paperId, passageFromPdfTextSpan, readSelectionCapture, readerState, rememberPassage]);

  const saveSelectedHighlight = () => {
    const capture = readSelectionCapture();
    const passage = capture.passage || (capture.useRemembered ? lastSelectedPassageRef.current || capturedPassage : null);
    if (!passage) {
      setSelectionStatus({ tone: "error", message: capture.error || "Select a passage, then choose Save highlight." });
      return;
    }
    const id = safeId();
    const now = new Date().toISOString();
    const annotation: Annotation = {
      id,
      paperId,
      citation,
      quote: passage.quote,
      note: "",
      page: passage.page,
      ...(passage.anchor ? { anchor: passage.anchor } : {}),
      source: documentSource || "citation only",
      createdAt: now,
      updatedAt: now,
    };
    const result = commitLocalAnnotation(() => onEnsureSaved(paper), () => onAddAnnotation(annotation));
    if (result !== "saved") {
      setSelectionStatus({
        tone: "error",
        message: result === "paper-storage-failed"
          ? "The highlight could not be saved because this browser could not retain the paper. The passage is ready to retry after browser storage is available."
          : "The highlight could not be saved in this browser. The passage is ready to retry; export your reading list if storage remains unavailable.",
      });
      return;
    }
    lastSelectedPassageRef.current = null;
    setCapturedPassage(null);
    setLastSavedAnnotationId(id);
    window.getSelection()?.removeAllRanges();
    setSelectionStatus({ tone: "success", message: `Highlight saved on page ${passage.page}. ${annotations.length + 1} ${annotations.length ? "annotations are" : "annotation is"} now saved locally.` });
  };

  const updateAnnotationNote = (id: string, note: string) => {
    const saved = onUpdateAnnotation(id, note);
    setNoteStatuses((current) => ({
      ...current,
      [id]: saved
        ? { tone: "success", message: "Note saved locally." }
        : { tone: "error", message: "This browser could not save the note. Copy the text before retrying." },
    }));
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

  const savePaperNote = () => {
    const note = draftNote.trim();
    if (!note) {
      setActionStatus("Write a paper-level note before saving.");
      return;
    }
    const id = safeId();
    const now = new Date().toISOString();
    const annotation: Annotation = { id, paperId, citation, quote: "", note, page: null, source: documentSource || "citation only", createdAt: now, updatedAt: now };
    const result = commitLocalAnnotation(() => onEnsureSaved(paper), () => onAddAnnotation(annotation));
    if (result !== "saved") {
      setActionStatus(result === "paper-storage-failed" ? "This browser could not retain the paper, so the note was not saved. Your text remains here to retry." : "This browser could not save the note. Your text remains here to retry or copy.");
      return;
    }
    setLastSavedAnnotationId(id);
    setDraftNote("");
    setActionStatus("Paper-level note saved locally.");
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
    <header className="reading-room__header"><div><p className="eyebrow">Brilliant Reading Room</p><h1 id="reading-room-title">{paper.title}</h1><p>{citation}</p><div className="reader-source-row"><span>{documentSource || "citation only"}</span>{localFileName && <span>{localFileName}</span>}<span>{annotations.length} {annotations.length === 1 ? "annotation" : "annotations"}</span><span>Reader {readerRelease}</span></div></div><button ref={closeButtonRef} className="reader-close" type="button" onClick={closeReader} aria-label="Close Reading Room">×</button></header>
    <div className="reading-room__toolbar"><div>{readerState === "ready" && <><button className={mode === "text" ? "is-active" : ""} type="button" onClick={() => switchMode("text")}>Selectable text</button><button className={mode === "pdf" ? "is-active" : ""} type="button" onClick={() => switchMode("pdf")}>Original PDF</button></>}<button type="button" onClick={copyCitation}>Copy citation</button><button type="button" onClick={downloadNotes}>Download notes (.md)</button><button type="button" onClick={() => downloadText(`${paper.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ris`, citationToRis(paper), "application/x-research-info-systems")}>Export RIS</button></div><div><label className="reader-upload">Upload PDF<input className="sr-only" type="file" accept="application/pdf,.pdf" onChange={(event) => { void uploadPdf(event.target.files?.[0]); event.target.value = ""; }} /></label>{documentSource === "user-uploaded PDF" && <button type="button" onClick={() => void forgetLocalPdf()}>Forget local PDF</button>}{paper.openAccessUrl && <a href={paper.openAccessUrl} target="_blank" rel="noreferrer">Open OA source ↗</a>}</div></div>
    <div className="reading-room__workspace"><main className="reader-document" ref={readerDocumentRef} aria-label="Paper content">
      <div className={`reader-notice reader-notice--${readerState}`} role="status"><strong>{readerState === "ready" ? "Reading copy ready" : readerState === "loading" ? "Preparing reading copy" : "Citation and notes mode"}</strong><p>{readerMessage}</p></div>
      {readerState === "loading" && <div className="reader-loading" aria-hidden="true" />}
      {readerState === "fallback" && <section className="reader-fallback"><h2>The source must stay outside Brilliant.</h2><p>Publisher access rules and browser CORS protections are respected. Open the source in a new tab, or use <strong>Upload PDF</strong> above to attach a copy you obtained legally through your library or proxy. The file is processed locally and is never sent to Brilliant.</p></section>}
      {readerState === "ready" && <><div className="reader-selection-tools"><div className="reader-selection-instructions">{selectableTextAvailable ? <><p>Drag across text in the {mode === "pdf" ? "PDF" : "extracted text"}. In PDF view, you can also click a text line. Wait for <strong>Selection ready</strong>, then choose <strong>Save highlight</strong>.</p>{selectionStatus ? <p className={`reader-selection-status reader-selection-status--${selectionStatus.tone}`} role="status" aria-live="polite">{selectionStatus.message}</p> : <p className="reader-selection-capability" role="status">Selectable text layer detected. No passage is ready yet.</p>}</> : <p className="reader-selection-status reader-selection-status--error" role="alert">This PDF has no selectable text layer and may be a scan. Highlighting is unavailable for this file. Attach an OCR-enabled PDF, switch to a text-enabled copy, or add a paper note.</p>}</div><div><button type="button" disabled={!selectableTextAvailable} onClick={saveSelectedHighlight}>Save highlight</button><span className="reader-saved-count" aria-live="polite">{annotations.length} saved</span><button type="button" disabled={!selectableTextAvailable} onClick={readSelection}>Read selection aloud</button><label className="speech-rate">Speed<select value={speechRate} onChange={(event) => setSpeechRate(Number(event.target.value))}><option value="0.75">0.75×</option><option value="0.9">0.9×</option><option value="1">1×</option><option value="1.15">1.15×</option><option value="1.3">1.3×</option><option value="1.5">1.5×</option><option value="1.7">1.7×</option></select></label>{speechState !== "idle" && <><button type="button" onClick={toggleSpeech}>{speechState === "playing" ? "Pause" : "Resume"}</button><button type="button" onClick={stopSpeech}>Stop</button></>}</div></div>{speechText && <p className="reader-speech-status">Speaking selection locally in your browser at {speechRate}×.</p>}<div className="reader-summary reader-summary--document"><AiSummary paper={paper} pdf={summaryPdf} /></div>{mode === "text" && <div className="reader-pages" ref={textPaneRef}>{pages.map((page, index) => <article className="reader-page" data-reader-page={index + 1} key={index}><p className="eyebrow">Page {index + 1}</p><div>{highlightedText(page, annotations.filter((item) => item.page === index + 1))}</div></article>)}</div>}{mode === "pdf" && pdfDocument && <PdfDocumentView document={pdfDocument} pageDimensions={pageDimensions} annotations={annotations} paneRef={pdfPaneRef} />}</>}
    </main>
    <aside className="annotation-panel" aria-label="Notes and highlights"><div className="annotation-compose"><p className="eyebrow">Add paper note</p><p className="annotation-compose__hint">Highlights save immediately from the reading toolbar. Add commentary to a saved highlight below, or create a note about the whole paper here.</p><label>Paper note<textarea value={draftNote} onChange={(event) => setDraftNote(event.target.value)} rows={4} placeholder="What should you remember about this paper?" /></label><button type="button" onClick={savePaperNote}>Save paper note</button><p className="reader-action-status" aria-live="polite">{actionStatus}</p></div>
      <div className="annotation-list"><div><p className="eyebrow">Research record</p><h2>{annotations.length} saved</h2></div>{annotations.length ? annotations.map((annotation) => <article className={annotation.id === lastSavedAnnotationId ? "is-new" : ""} key={annotation.id}><div className="annotation-meta"><span>{annotation.source}</span><span>{annotation.page ? `Page ${annotation.page}` : "Paper note"}</span><time dateTime={annotation.updatedAt}>{new Date(annotation.updatedAt).toLocaleDateString()}</time></div>{annotation.quote && <blockquote>{annotation.quote}</blockquote>}<label>Note<textarea value={annotation.note} onChange={(event) => updateAnnotationNote(annotation.id, event.target.value)} rows={3} placeholder={annotation.quote ? "Add commentary to this highlight…" : "Edit paper note…"} /></label><p className={`annotation-save-status annotation-save-status--${noteStatuses[annotation.id]?.tone || "idle"}`} role="status" aria-live="polite">{noteStatuses[annotation.id]?.message || "Notes save locally as you type."}</p><p className="annotation-citation"><strong>Citation</strong>{annotation.citation}</p><button type="button" onClick={() => onDeleteAnnotation(annotation.id)}>Delete annotation</button></article>) : <div className="annotation-empty"><span aria-hidden="true">✦</span><p>No annotations yet. Select a passage and choose Save highlight, or add a paper-level note.</p></div>}</div>
    </aside></div>
  </div>;
}
