import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { LANGS, setLang, useLang, type Lang } from "../i18n";
import { IS_PUBLIC_SITE } from "../lib/public-site";

export function SiteBrand({ href = "/" }: { href?: string }) {
  return (
    <a href={href} className="flex items-center gap-3" aria-label="OmniCloud">
      <span className="relative h-9 w-9 shrink-0">
        <img
          src="/brand/logo-mark.svg"
          alt=""
          className="brand-mark-dark absolute inset-0 h-9 w-9"
        />
        <img
          src="/brand/logo-mark-light.svg"
          alt=""
          className="brand-mark-light absolute inset-0 h-9 w-9"
        />
      </span>
      <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">
        Omni<span className="muted font-normal">Cloud</span>
      </span>
    </a>
  );
}

type ActiveNav = "download" | null;

export function SiteHeader({ active = null }: { active?: ActiveNav }) {
  const [lang, t] = useLang();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-30 transition-all duration-300 ${
        scrolled ? "border-b border-line bg-bg/80 backdrop-blur-xl" : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
        <SiteBrand />
        <nav className="hidden items-center gap-7 text-sm muted md:flex" aria-label="Primary">
          <a href="/#features" className="transition-colors hover:text-text">
            {t.nav.features}
          </a>
          <a href="/#security" className="transition-colors hover:text-text">
            {t.nav.security}
          </a>
          <a href="/#open-source" className="transition-colors hover:text-text">
            {t.nav.openSource}
          </a>
          <a href="/docs" className="transition-colors hover:text-text">
            {t.nav.docs}
          </a>
          <a
            href="/download"
            className={
              active === "download" ? "font-medium text-text" : "transition-colors hover:text-text"
            }
          >
            {t.nav.download}
          </a>
        </nav>
        <div className="flex items-center gap-2.5">
          <label className="sr-only" htmlFor="site-lang">
            {t.langSwitcher.label}
          </label>
          <select
            id="site-lang"
            value={lang}
            onChange={(event) => setLang(event.target.value as Lang)}
            className="h-9 rounded-xl border border-line bg-surface/70 px-2 text-sm font-medium uppercase hover:bg-surface"
          >
            {LANGS.map((code) => (
              <option key={code} value={code}>
                {t.langSwitcher[code]}
              </option>
            ))}
          </select>
          <ThemeToggle />
          {IS_PUBLIC_SITE ? null : (
            <a
              href="/login"
              className="hidden rounded-xl border border-line bg-surface/70 px-3.5 py-2 text-sm font-medium hover:bg-surface sm:block"
            >
              {t.nav.signIn}
            </a>
          )}
          <a href="/download" className="btn-gold px-3.5 py-2 text-sm">
            {t.nav.getApp}
            <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
          </a>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const [, t] = useLang();
  return (
    <footer className="relative z-10 border-t border-line">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row sm:px-8">
        <SiteBrand />
        <nav
          className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs muted"
          aria-label="Footer"
        >
          <a href="/#features" className="transition-colors hover:text-text">
            {t.footer.features}
          </a>
          <a
            href="https://github.com/Hilbras/OmniCloud/blob/main/SECURITY.md"
            className="transition-colors hover:text-text"
          >
            {t.footer.security}
          </a>
          <a href="/about" className="transition-colors hover:text-text">
            {t.nav.openSource}
          </a>
          <a href="/faq" className="transition-colors hover:text-text">
            FAQ
          </a>
          <a href="/privacy" className="transition-colors hover:text-text">
            {t.footer.privacy}
          </a>
          <a href="/terms" className="transition-colors hover:text-text">
            {t.footer.terms}
          </a>
          <a
            href="https://github.com/Hilbras/OmniCloud"
            className="transition-colors hover:text-text"
          >
            {t.footer.github}
          </a>
          {IS_PUBLIC_SITE ? null : (
            <a href="/login" className="transition-colors hover:text-text">
              {t.footer.signIn}
            </a>
          )}
        </nav>
        <p className="text-xs muted">{t.footer.license}</p>
      </div>
    </footer>
  );
}
