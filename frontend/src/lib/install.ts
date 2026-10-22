import { useEffect, useState } from "react";

/** Captura o convite de instalação da PWA assim que o navegador o oferece (antes de qualquer tela montar). */
interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: BeforeInstallPromptEvent | null = null;
const subs = new Set<() => void>();
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as BeforeInstallPromptEvent; subs.forEach((f) => f()); });
window.addEventListener("appinstalled", () => { deferred = null; subs.forEach((f) => f()); });

const standalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);

export function useInstall() {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return {
    installed: standalone(),
    /** Chrome/Edge/Android: há convite nativo. iOS: só pelo menu Compartilhar → Adicionar à Tela de Início. */
    canPrompt: !!deferred,
    iosHint: !standalone() && ios(),
    async prompt() {
      if (!deferred) return false;
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null; subs.forEach((f) => f());
      return outcome === "accepted";
    },
  };
}
