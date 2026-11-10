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
import { useEffect, useState } from "react";
import { SiteFooter, SiteHeader } from "../components/SiteShell";
import { GitHubButtons } from "../components/GitHubButtons";
import { useLang } from "../i18n";
import { usePageMeta } from "../lib/seo";

const RELEASE_URL = "https://github.com/Hilbras/OmniCloud/releases/latest";
const SOURCE_URL = "https://github.com/Hilbras/OmniCloud";
const NPM_URL = "https://www.npmjs.com/package/@hilbras/omnicloud";

const EASE = [0.22, 1, 0.36, 1] as const;
const PLATFORM_ICONS = [Terminal, Laptop, Monitor] as const;
const PLATFORM_KEYS = ["linux", "macos", "windows"] as const;

interface DownloadAsset {
  name: string;
  url: string;
  size: number;
  kind: string;
}

interface ReleaseInfo {
  version: string | null;
  page: string;
  assets: DownloadAsset[];
}

function hasArch(name: string, arch: "x64" | "arm64"): boolean {
  const lower = name.toLowerCase();
  if (arch === "x64") {
    return /x64|amd64|x86_64|x86-64/.test(lower);
  }
  return lower.includes("arm64") || lower.includes("aarch64");
}

function findAsset(
  assets: DownloadAsset[],
  kind: string,
  arch?: "x64" | "arm64",
): DownloadAsset | undefined {
  return assets.find(
    (asset) => asset.kind === kind && (arch === undefined || hasArch(asset.name, arch)),
  );
}

/** Drops the product and version prefix so alternate links stay readable. */
function shortName(name: string): string {
  return name.replace(/^OmniCloud-[^-]+-/, "");
}

export default function DownloadPage() {
  const [lang, t] = useLang();
  const reduceMotion = useReducedMotion();
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  usePageMeta({ title: t.download.seoTitle, description: t.download.seoDescription });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/downloads")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("failed"))))
      .then((data: ReleaseInfo) => {
        if (!cancelled) setRelease(data);
      })
      .catch(() => {
        if (!cancelled) setRelease({ version: null, page: RELEASE_URL, assets: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const assets = release?.assets ?? [];
  const version = release?.version ?? null;

  const platformLinks = (key: (typeof PLATFORM_KEYS)[number]) => {
    if (key === "linux") {
      const appImage = findAsset(assets, "appimage", "x64") ?? findAsset(assets, "appimage");
      const rest = assets.filter(
        (asset) => ["appimage", "deb"].includes(asset.kind) && asset !== appImage,
      );
      return { primary: appImage, alternates: rest };
    }
    if (key === "macos") {
      const dmg = findAsset(assets, "dmg", "arm64") ?? findAsset(assets, "dmg");
      const rest = assets.filter((asset) => ["dmg", "zip"].includes(asset.kind) && asset !== dmg);
      return { primary: dmg, alternates: rest };
    }
    const exe = findAsset(assets, "exe", "x64") ?? findAsset(assets, "exe");
    return { primary: exe, alternates: [] };
  };

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

      <SiteHeader active="download" />

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
            <GitHubButtons className="mt-4" />
          </motion.div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-5 pb-6 sm:px-8">
          <div className="grid gap-4 md:grid-cols-3">
            {PLATFORM_KEYS.map((key, index) => {
              const Icon = PLATFORM_ICONS[index] ?? Monitor;
              const platform = t.download.platforms[key];
              const links = platformLinks(key);
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
                    href={links.primary?.url ?? release?.page ?? RELEASE_URL}
                    className="btn-gold mt-4 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm"
                    download
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    {version !== null ? `${t.download.latest} · ${version}` : t.download.latest}
                  </a>
                  {links.alternates.length > 0 ? (
                    <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[12px]">
                      {links.alternates.map((asset) => (
                        <a
                          key={asset.url}
                          href={asset.url}
                          download
                          className="muted underline-offset-2 hover:text-text hover:underline"
                        >
                          {shortName(asset.name)}
                        </a>
                      ))}
                    </div>
                  ) : null}
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

      <SiteFooter />
    </div>
  );
}
