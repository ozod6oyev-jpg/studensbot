import { useCallback, useEffect, useState } from "react";
import {
  getTelegramWebApp,
  haptic,
  isMiniApp,
  miniAppUserName,
  sendToChat as postToChat,
  type MiniAppSendPayload,
  type MiniAppSendResult,
  type TelegramWebAppUser,
} from "@/lib/telegram/mini-app";

export type MiniAppSendStatus = "idle" | "sending" | "sent" | "error";

export interface MiniAppSendState {
  status: MiniAppSendStatus;
  message: string | null;
}

/**
 * Studio sahifasining Telegram Mini App holati.
 *
 * - Telegram ichida ochilganda `active = true` bo'ladi, oyna kengaytiriladi va
 *   `document.body` ga `mini-app` klassi qo'shiladi (Telegram oynasi uchun
 *   qo'shimcha bo'sh joy);
 * - `sendToChat()` — matn va sozlamalarni botga yuborib, natijani chatga
 *   qaytaradi; holat (yuborilmoqda / yuborildi / xato) shu hookda saqlanadi.
 */
export function useMiniApp() {
  const [active] = useState(() => isMiniApp());
  const [user] = useState<TelegramWebAppUser | null>(
    () => getTelegramWebApp()?.initDataUnsafe?.user ?? null,
  );
  const [send, setSend] = useState<MiniAppSendState>({ status: "idle", message: null });

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

  const sendToChat = useCallback(async (payload: MiniAppSendPayload): Promise<MiniAppSendResult> => {
    setSend({ status: "sending", message: null });
    const result = await postToChat(payload);
    if (result.ok) haptic("success");
    else haptic("error");
    setSend({ status: result.ok ? "sent" : "error", message: result.message });
    return result;
  }, []);

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
    reset,
    close,
  };
}
