import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "./SiteShell";
import { usePageMeta } from "../lib/seo";

interface InfoLayoutProps {
  title: string;
  description: string;
  path: string;
  eyebrow: string;
  intro?: string;
  children: ReactNode;
}

/** Shared shell for static informational pages (about, privacy, terms, FAQ). */
export function InfoLayout({
  title,
  description,
  path,
  eyebrow,
  intro,
  children,
}: InfoLayoutProps) {
  usePageMeta({ title, description, path });

  return (
    <div className="relative min-h-dvh overflow-x-clip bg-bg">
      <a href="#main" className="skip-link btn-gold">
        Skip to content
      </a>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-[55%] h-[32rem] w-[32rem] rounded-full bg-gold/8 blur-3xl" />
      </div>
      <SiteHeader />
      <main
        id="main"
        className="relative z-10 mx-auto w-full max-w-3xl px-5 py-12 sm:px-8 lg:py-16"
      >
        <p className="mb-3 text-xs font-semibold tracking-[0.16em] text-gold-text">{eyebrow}</p>
        <h1 className="text-4xl font-semibold leading-[1.1] tracking-[-0.05em] sm:text-5xl">
          {title}
        </h1>
        {intro !== undefined ? <p className="muted mt-4 text-base leading-7">{intro}</p> : null}
        <div className="prose-omni mt-8 space-y-6 text-[15px] leading-7">{children}</div>
        <p className="muted mt-10 text-xs">
          Last updated: 11 November 2026 · Questions:{" "}
          <a
            href="https://github.com/Hilbras/OmniCloud/issues"
            className="text-gold-text hover:underline"
          >
            open an issue
          </a>
          .
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
