import { useCallback, useEffect, useState } from "react";
import {
  fetchNotebookState,
  getTelegramWebApp,
  haptic,
  isMiniApp,
  manageNotebook as postNotebookAction,
  miniAppUserName,
  sendToChat as postToChat,
  type MiniAppNotebookPayload,
  type MiniAppNotebookResult,
  type MiniAppSendPayload,
  type MiniAppSendResult,
  type MiniAppState,
  type TelegramWebAppUser,
} from "@/lib/telegram/mini-app";

export type MiniAppSendStatus = "idle" | "sending" | "sent" | "error";

export interface MiniAppSendState {
  status: MiniAppSendStatus;
  message: string | null;
}

export type MiniAppStateStatus = "idle" | "loading" | "ready" | "error";

/** Daftar amali (yaratish/nomlash/o'chirish/undo/kitob) holati. */
export type MiniAppNotebookStatus = "idle" | "working" | "done" | "error";

export interface MiniAppNotebookState {
  status: MiniAppNotebookStatus;
  message: string | null;
}

/**
 * Chatdagi daftarlar ro'yxati va tanlangan daftarning joriy beti.
 *
 * `state` — botdan olingan ma'lumot (qaysi daftarlar bor, qaysi biri ochiq va
 * qaysi betning qaysi qatoridan yozish davom etadi); `message` — xato bo'lsa
 * foydalanuvchiga ko'rsatiladigan qisqa izoh.
 */
export interface MiniAppStateBundle {
  status: MiniAppStateStatus;
  state: MiniAppState | null;
  message: string | null;
}

/**
 * Studio sahifasining Telegram Mini App holati.
 *
 * - Telegram ichida ochilganda `active = true` bo'ladi, oyna kengaytiriladi va
 *   `document.body` ga `mini-app` klassi qo'shiladi (Telegram oynasi uchun
 *   qo'shimcha bo'sh joy);
 * - `reloadState()` — chatdagi daftarlar ro'yxatini va tanlangan daftarning
 *   joriy betini botdan oladi (Mini App ochilganda bir marta o'zi yuklanadi);
 * - `sendToChat()` — matn va sozlamalarni botga yuborib, natijani chatga
 *   qaytaradi; holat (yuborilmoqda / yuborildi / xato) shu hookda saqlanadi.
 */
export function useMiniApp() {
  const [active] = useState(() => isMiniApp());
  const [user] = useState<TelegramWebAppUser | null>(
    () => getTelegramWebApp()?.initDataUnsafe?.user ?? null,
  );
  const [send, setSend] = useState<MiniAppSendState>({ status: "idle", message: null });
  const [state, setState] = useState<MiniAppStateBundle>({
    status: "idle",
    state: null,
    message: null,
  });
  const [notebook, setNotebook] = useState<MiniAppNotebookState>({
    status: "idle",
    message: null,
  });

  useEffect(() => {
    if (!active) return;
    const app = getTelegramWebApp();
    if (!app) return;

    try {
      app.ready();
      app.expand();
      const background = app.themeParams?.bg_color;
      const header = app.themeParams?.header_bg_color ?? background;
      if (header) app.setHeaderColor?.(header);
      if (background) app.setBackgroundColor?.(background);
    } catch {
      // Eski Telegram versiyalari bu metodlarni bilmasligi mumkin.
    }

    document.body.classList.add("mini-app");
    return () => document.body.classList.remove("mini-app");
  }, [active]);

  /** Daftarlar ro'yxatini (va tanlangan daftarning joriy betini) yangilaydi. */
  const reloadState = useCallback(async (notebookId?: string | null): Promise<void> => {
    setState((prev) => ({ status: "loading", state: prev.state, message: null }));
    const result = await fetchNotebookState(notebookId);
    if (result.ok) {
      setState({ status: "ready", state: result.state ?? null, message: null });
      return;
    }
    setState({
      status: "error",
      state: null,
      message: result.message ?? "Daftarlar ro'yxatini olib bo'lmadi.",
    });
  }, []);

  // Mini App ochilishi bilan daftarlar ro'yxati ko'rinib turishi kerak —
  // foydalanuvchi qo'shimcha tugma bosmasin. Brauzerda so'rov yuborilmaydi.
  useEffect(() => {
    if (!active) return;
    void reloadState();
  }, [active, reloadState]);

  const sendToChat = useCallback(async (payload: MiniAppSendPayload): Promise<MiniAppSendResult> => {
    setSend({ status: "sending", message: null });
    const result = await postToChat(payload);
    if (result.ok) haptic("success");
    else haptic("error");
    setSend({ status: result.ok ? "sent" : "error", message: result.message });
    return result;
  }, []);

  /**
   * Daftar bilan amal bajaradi (yangi daftar, nom, o'chirish, undo, kitob) va
   * natijadan keyin ro'yxatni yangilaydi — shunda yangi holat darhol ko'rinadi.
   */
  const manageNotebook = useCallback(
    async (payload: MiniAppNotebookPayload): Promise<MiniAppNotebookResult> => {
      setNotebook({ status: "working", message: null });
      const result = await postNotebookAction(payload);
      haptic(result.ok ? "success" : "error");
      setNotebook({ status: result.ok ? "done" : "error", message: result.message });
      if (result.ok) await reloadState(result.notebookId ?? undefined);
      return result;
    },
    [reloadState],
  );

  const reset = useCallback(() => setSend({ status: "idle", message: null }), []);

  const close = useCallback(() => {
    try {
      getTelegramWebApp()?.close();
    } catch {
      // Brauzerda hech narsa qilmaymiz.
    }
  }, []);

  return {
    /** Sahifa Telegram Mini App sifatida ochilganmi. */
    active,
    /** Mini App ichidagi foydalanuvchi (bo'lmasa `null`). */
    user,
    userName: active ? miniAppUserName() : null,
    send,
    sendToChat,
    /** Daftarlar ro'yxati va joriy bet holati. */
    state,
    /** Daftarlar ro'yxatini qayta o'qish (yoki boshqa daftarni tanlash). */
    reloadState,
    /** Daftar amali holati (xabar va "bajarilmoqda" belgisi). */
    notebook,
    /** Daftar amalini bajarish: yaratish, nomlash, o'chirish, undo, PDF kitob. */
    manageNotebook,
    /** Daftar amali bajarilmoqda (tugmalarni bloklash uchun). */
    notebookBusy: notebook.status === "working",
    reset,
    close,
  };
}
