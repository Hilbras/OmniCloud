import {
  ArrowLeft,
  ArrowRight,
  Check,
  CodeXml,
  Download,
  Laptop,
  Monitor,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { ThemeToggle } from "../components/ThemeToggle";
import { LANGS, setLang, useLang, type Lang } from "../i18n";
import { usePageMeta } from "../lib/seo";

const RELEASE_URL = "https://github.com/Hilbras/OmniCloud/releases/latest";
const SOURCE_URL = "https://github.com/Hilbras/OmniCloud";
const NPM_URL = "https://www.npmjs.com/package/@hilbras/omnicloud";

const EASE = [0.22, 1, 0.36, 1] as const;
const PLATFORM_ICONS = [Terminal, Laptop, Monitor] as const;
const PLATFORM_KEYS = ["linux", "macos", "windows"] as const;

function Brand({ href = "/" }: { href?: string }) {
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

export default function DownloadPage() {
  const [lang, t] = useLang();
  const reduceMotion = useReducedMotion();
  usePageMeta({ title: t.download.seoTitle, description: t.download.seoDescription });

  const reveal = (delay = 0) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 24 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: "-70px" },
          transition: { duration: 0.55, ease: EASE, delay },
        };

  return (
    <div className="relative min-h-dvh overflow-x-clip bg-bg" lang={lang} dir={t.meta.dir}>
      <a href="#main" className="skip-link btn-gold">
        {t.meta.skip}
      </a>

      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-[55%] h-[32rem] w-[32rem] rounded-full bg-gold/8 blur-3xl" />
        <div className="absolute top-[38%] -left-40 h-[26rem] w-[26rem] rounded-full bg-gold/5 blur-3xl" />
      </div>

      <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <Brand />
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
            <span className="font-medium text-text">{t.nav.download}</span>
          </nav>
          <div className="flex items-center gap-2.5">
            <label className="sr-only" htmlFor="download-lang">
              {t.langSwitcher.label}
            </label>
            <select
              id="download-lang"
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
            <a
              href="/login"
              className="hidden rounded-xl border border-line bg-surface/70 px-3.5 py-2 text-sm font-medium hover:bg-surface sm:block"
            >
              {t.nav.signIn}
            </a>
            <a href="/login" className="btn-gold px-3.5 py-2 text-sm">
              {t.nav.getStarted}
              <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
            </a>
          </div>
        </div>
      </header>

      <main id="main" className="relative z-10">
        <section className="mx-auto w-full max-w-6xl px-5 pb-10 pt-12 sm:px-8 lg:pt-16">
          <motion.div {...reveal()} className="max-w-3xl">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-gold/25 bg-gold/10 px-3.5 py-2 text-xs font-semibold tracking-wide text-gold-text">
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              {t.download.kicker}
            </p>
            <h1 className="text-4xl font-semibold leading-[1.08] tracking-[-0.055em] sm:text-5xl xl:text-6xl">
              {t.download.titleA}
              <br />
              <span className="text-gold-text">{t.download.titleB}</span>
            </h1>
            <p className="muted mt-5 max-w-2xl text-base leading-7">{t.download.subtitle}</p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a href={RELEASE_URL} className="btn-gold px-5 py-2.5 text-sm">
                {t.download.latest}
                <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
              </a>
              <a
                href={SOURCE_URL}
                className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface/70 px-4 py-2.5 text-sm font-medium hover:bg-surface"
              >
                <CodeXml className="h-4 w-4" aria-hidden="true" />
                {t.download.source}
              </a>
            </div>
          </motion.div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-5 pb-6 sm:px-8">
          <div className="grid gap-4 md:grid-cols-3">
            {PLATFORM_KEYS.map((key, index) => {
              const Icon = PLATFORM_ICONS[index] ?? Monitor;
              const platform = t.download.platforms[key];
              return (
                <motion.article
                  key={key}
                  {...reveal(index * 0.08)}
                  className="flex flex-col rounded-2xl border border-line bg-surface/75 p-5 shadow-sm backdrop-blur"
                >
                  <div className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-gold/10 text-gold-text">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h2 className="text-[15px] font-semibold tracking-tight">{platform.title}</h2>
                  <p className="muted mt-2 flex-1 text-sm leading-6">{platform.body}</p>
                  <p className="muted mt-3 text-[11px] font-semibold tracking-wide uppercase">
                    {platform.formats}
                  </p>
                  <a
                    href={RELEASE_URL}
                    className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-bg/60 px-4 py-2.5 text-sm font-medium hover:bg-surface"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    {t.download.latest}
                  </a>
                </motion.article>
              );
            })}
          </div>
          <p className="notice mt-4 flex items-start gap-2 text-[12.5px]">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold-text" aria-hidden="true" />
            {t.download.note}
          </p>
        </section>

        <section className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-8">
          <motion.div
            {...reveal()}
            className="grid items-center gap-8 rounded-[1.5rem] border border-line bg-surface/75 p-6 shadow-sm backdrop-blur sm:p-10 lg:grid-cols-2"
          >
            <div>
              <p className="mb-3 text-xs font-semibold tracking-[0.16em] text-gold-text">
                {t.download.cli.kicker}
              </p>
              <h2 className="text-3xl font-semibold tracking-[-0.045em]">{t.download.cli.title}</h2>
              <p className="muted mt-4 text-sm leading-6">{t.download.cli.body}</p>
              <a
                href={NPM_URL}
                className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-gold-text hover:underline"
              >
                {t.openSource.npm}
                <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
              </a>
            </div>
            <div className="min-w-0 rounded-2xl border border-line bg-bg/80 p-4 sm:p-5">
              <pre
                dir="ltr"
                className="overflow-x-auto rounded-xl bg-bg-soft/80 p-4 text-[12.5px] leading-6"
              >
                <code>
                  <span className="muted">$</span> {t.download.cli.install}
                  {"\n"}
                  <span className="muted">$</span> {t.download.cli.run}
                </code>
              </pre>
            </div>
          </motion.div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-5 pb-16 sm:px-8">
          <motion.div {...reveal()} className="rounded-2xl border border-line bg-surface/75 p-6">
            <h2 className="text-sm font-semibold tracking-tight">
              {t.download.requirements.title}
            </h2>
            <ul className="mt-4 grid gap-2.5 text-sm sm:grid-cols-2">
              {t.download.requirements.items.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-gold-text" aria-hidden="true" />
                  <span className="muted leading-6">{item}</span>
                </li>
              ))}
            </ul>
            <a
              href="/"
              className="muted mt-6 inline-flex items-center gap-2 text-sm hover:text-text"
            >
              <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
              {t.download.back}
            </a>
          </motion.div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row sm:px-8">
          <Brand />
          <nav className="flex items-center gap-5 text-xs muted" aria-label="Footer">
            <a href="/#features" className="transition-colors hover:text-text">
              {t.footer.features}
            </a>
            <a
              href="https://github.com/Hilbras/OmniCloud/blob/main/SECURITY.md"
              className="transition-colors hover:text-text"
            >
              {t.footer.security}
            </a>
            <a href={SOURCE_URL} className="transition-colors hover:text-text">
              {t.footer.github}
            </a>
            <a href="/login" className="transition-colors hover:text-text">
              {t.footer.signIn}
            </a>
          </nav>
          <p className="text-xs muted">{t.footer.license}</p>
        </div>
      </footer>
    </div>
  );
}
