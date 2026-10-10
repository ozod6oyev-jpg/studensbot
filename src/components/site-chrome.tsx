import { Link, useLocation } from "react-router-dom";
import { NotebookPen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMiniApp } from "@/hooks/use-mini-app";

const links = [
  { href: "/studio", label: "Studio" },
  { href: "/bot", label: "Botni ulash" },
];

export function SiteHeader({
  className,
  showBotSetup = true,
}: {
  className?: string;
  /**
   * `false` — «Botni ulash» havolasi ko'rsatilmaydi (Studio sahifasi: u yerda
   * botni ulash haqidagi ma'lumot umuman chiqmaydi).
   */
  showBotSetup?: boolean;
}) {
  const { pathname } = useLocation();
  const { active } = useMiniApp();
  const navLinks = showBotSetup ? links : links.filter((link) => link.href !== "/bot");

  // Mini App ichida Telegram o'z sarlavhasini chizadi: sayt sarlavhasini
  // takrorlamaymiz (aks holda ekranda ikkita header bo'lib qoladi) va
  // foydalanuvchini Telegram oynasidan tashqariga chiqarib yubormaymiz.
  if (active) return null;

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-paper-edge/80 bg-paper/80 backdrop-blur-md",
        className,
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5">
        <Link to="/" className="group flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-paper shadow-note transition-transform group-hover:-rotate-6">
            <NotebookPen className="h-5 w-5" />
          </span>
          <span className="leading-tight">
            <span className="hand block text-xl text-ink">Student Daftari</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-pencil/60">
              qo'lyozma generatori
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-1.5">
          {navLinks.map((link) => {
            // `isCurrent` — shu sahifa ochiqmi (yuqoridagi `active` — Mini App
            // holati; ikkalasi aralashib ketmasligi uchun nom boshqacha).
            const isCurrent = pathname === link.href;
            return (
              <Link
                key={link.href}
                to={link.href}
                aria-current={isCurrent ? "page" : undefined}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
                  isCurrent ? "bg-ink/8 text-ink" : "text-pencil/70 hover:bg-ink/5 hover:text-ink",
                )}
              >
                {link.label}
              </Link>
            );
          })}
          <Link
            to="/studio"
            className="ml-1 hidden rounded-xl bg-marker px-4 py-2 text-sm font-semibold text-ink shadow-note transition-transform hover:-translate-y-0.5 sm:block"
          >
            Sinab ko'rish
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter({ showBotSetup = true }: { showBotSetup?: boolean } = {}) {
  const { active } = useMiniApp();

  // Mini App ichida sayt futeri ham ortiqcha: Telegram oynasi tor va u yerda
  // faqat asosiy ish (yozish va chatga yuborish) ko'rinib turishi kerak.
  if (active) return null;

  return (
    <footer className="mt-20 border-t border-paper-edge/80 bg-paper-deep/60">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 py-8 text-sm text-pencil/70 sm:flex-row sm:items-center sm:justify-between">
        <p>
          <span className="hand text-lg text-ink">Student Daftari</span> — matnni daftarga qo'lda yozilgan
          ko'rinishda saqlaydi.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Link to="/studio" className="hover:text-ink">
            Studio
          </Link>
          {showBotSetup && (
            <>
              <Link to="/bot" className="hover:text-ink">
                Botni ulash
              </Link>
              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noreferrer"
                className="hover:text-ink"
              >
                BotFather
              </a>
            </>
          )}
        </div>
      </div>
    </footer>
  );
}
