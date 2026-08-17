import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { Annotation } from "./types";

type PageDimensions = { width: number; height: number };

function PdfPage({ document, pageNumber, dimensions, availableWidth, annotations }: {
  document: PDFDocumentProxy;
  pageNumber: number;
  dimensions: PageDimensions;
  availableWidth: number;
  annotations: Annotation[];
}) {
  const pageRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [renderError, setRenderError] = useState(false);
  const scale = Math.min(1.35, Math.max(0.25, availableWidth / dimensions.width));
  const width = dimensions.width * scale;
  const height = dimensions.height * scale;

  useEffect(() => {
    const element = pageRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setNearViewport(true);
    }, { root: element.closest(".reader-document"), rootMargin: "100% 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!nearViewport) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let textLayer: { cancel: () => void } | null = null;
    const render = async () => {
      const page = await document.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const outputViewport = page.getViewport({ scale: scale * pixelRatio });
      const canvas = canvasRef.current;
      const layer = textLayerRef.current;
      if (!canvas || !layer) return;
      canvas.width = Math.floor(outputViewport.width);
      canvas.height = Math.floor(outputViewport.height);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      layer.replaceChildren();
      const pdfjs = await import("pdfjs-dist");
      if (cancelled) return;
      renderTask = page.render({ canvas, viewport: outputViewport });
      const layerTask = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport });
      textLayer = layerTask;
      await Promise.all([renderTask.promise, layerTask.render()]);
      if (!cancelled) setRenderError(false);
    };
    void render().catch((error) => {
      if (!cancelled && !(error instanceof Error && error.name === "RenderingCancelledException")) setRenderError(true);
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [document, nearViewport, pageNumber, scale]);

  const style = {
    width: `${width}px`,
    height: `${height}px`,
    "--total-scale-factor": scale,
    "--scale-round-x": "1px",
    "--scale-round-y": "1px",
  } as CSSProperties;

  return <article className="reader-pdf-page" data-reader-page={pageNumber} ref={pageRef} style={style} aria-label={`PDF page ${pageNumber}`}>
    <canvas ref={canvasRef} aria-hidden="true" />
    <div className="reader-pdf-highlights" aria-hidden="true">
      {annotations.flatMap((annotation) => annotation.anchor?.kind === "pdf" && annotation.anchor.page === pageNumber
        ? annotation.anchor.rects.map((rect, index) => <span key={`${annotation.id}-${index}`} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }} />)
        : [])}
    </div>
    <div className="textLayer" ref={textLayerRef} />
    <span className="reader-pdf-page-label">Page {pageNumber}</span>
    {renderError && <p className="reader-pdf-page-error">This page could not be rendered. Its extracted text is still available.</p>}
  </article>;
}

export default function PdfDocumentView({ document, pageDimensions, annotations, paneRef }: {
  document: PDFDocumentProxy;
  pageDimensions: PageDimensions[];
  annotations: Annotation[];
  paneRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [availableWidth, setAvailableWidth] = useState(880);

  useLayoutEffect(() => {
    const element = paneRef.current;
    if (!element) return;
    const measure = () => setAvailableWidth(Math.max(240, Math.min(880, element.clientWidth)));
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [paneRef]);

  return <div className="reader-pdf-pages" ref={paneRef}>
    {pageDimensions.map((dimensions, index) => <PdfPage key={index + 1} document={document} pageNumber={index + 1} dimensions={dimensions} availableWidth={availableWidth} annotations={annotations} />)}
  </div>;
}
