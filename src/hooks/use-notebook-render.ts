import { useEffect, useRef, useState } from "react";
import { pngToObjectUrl, renderNotebookInBrowser } from "@/lib/handwriting/browser";
import type { NotebookStyle } from "@/lib/handwriting/types";

export interface RenderedPageMeta {
  index: number;
  total: number;
  width: number;
  height: number;
  url: string;
  bytes: number;
}

export interface NotebookRenderState {
  pages: RenderedPageMeta[];
  loading: boolean;
  error: string | null;
  warnings: string[];
  elapsedMs: number | null;
}

const IDLE: NotebookRenderState = {
  pages: [],
  loading: false,
  error: null,
  warnings: [],
  elapsedMs: null,
};

const DEBOUNCE_MS = 250;

/**
 * Matn yoki sozlamalar o'zgargach ~250 ms kutib, daftar rasmini brauzerda chizadi.
 * Eski (kechikib kelgan) natija yangisini ustidan yozmasligi kafolatlanadi.
 */
export function useNotebookRender(text: string, style: Partial<NotebookStyle>): NotebookRenderState {
  const [state, setState] = useState<NotebookRenderState>(IDLE);

  const sequenceRef = useRef(0);
  const urlsRef = useRef<string[]>([]);
  const staleRef = useRef<string[]>([]);
  const mountedRef = useRef(true);
  const styleKey = JSON.stringify(style);

  // Eski varaqa havolalari **keyingi renderdan keyin** bo'shatiladi: hozir
  // ekranda turgan `<img src>` hali o'sha havolani ko'rsatib turadi va uni
  // darhol bekor qilish rasmni bir kadrga sindirib qo'yardi (ayniqsa rasm hali
  // yuklanib ulgurmagan bo'lsa).
  useEffect(() => {
    const stale = staleRef.current;
    if (stale.length === 0) return;
    staleRef.current = [];
    for (const url of stale) URL.revokeObjectURL(url);
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const url of [...urlsRef.current, ...staleRef.current]) URL.revokeObjectURL(url);
      urlsRef.current = [];
      staleRef.current = [];
    };
  }, []);

  useEffect(() => {
    const trimmed = text.trim();

    if (!trimmed) {
      sequenceRef.current += 1;
      staleRef.current.push(...urlsRef.current);
      urlsRef.current = [];
      setState(IDLE);
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    const timer = setTimeout(() => {
      const requestId = ++sequenceRef.current;
      const startedAt = performance.now();

      void (async () => {
        try {
          const result = await renderNotebookInBrowser(text, style);
          if (requestId !== sequenceRef.current || !mountedRef.current) return;

          const urls = result.pages.map((page) => pngToObjectUrl(page.png));
          staleRef.current.push(...urlsRef.current);
          urlsRef.current = urls;

          setState({
            pages: result.pages.map((page, index) => ({
              index: page.index,
              total: page.total,
              width: page.width,
              height: page.height,
              url: urls[index],
              bytes: page.png.byteLength,
            })),
            loading: false,
            error: null,
            warnings: result.warnings,
            elapsedMs: Math.round(performance.now() - startedAt),
          });
        } catch (err) {
          if (requestId !== sequenceRef.current || !mountedRef.current) return;
          setState((prev) => ({
            ...prev,
            loading: false,
            error: `Rasm chizishda xatolik: ${err instanceof Error ? err.message : String(err)}`,
          }));
        }
      })();
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [text, styleKey]);

  return state;
}
