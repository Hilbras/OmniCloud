import { ArrowUpRight, BookOpen, ShieldCheck, Terminal, Wrench } from "lucide-react";
import { InfoLayout } from "../components/InfoLayout";

const REPO = "https://github.com/Hilbras/OmniCloud";
const DOCS = `${REPO}/blob/main/docs`;

const groups = [
  {
    icon: BookOpen,
    title: "Start here",
    items: [
      ["README", `${REPO}#readme`, "What OmniCloud is, quick start, feature matrix."],
      ["Architecture", `${DOCS}/architecture.md`, "Layers, request lifecycle, storage engine."],
      ["Deployment", `${DOCS}/deployment.md`, "Docker, systemd, TLS, WebDAV, local mode."],
      ["Troubleshooting", `${DOCS}/troubleshooting.md`, "Symptom-first fixes."],
    ],
  },
  {
    icon: Terminal,
    title: "Build with it",
    items: [
      ["API reference", `${DOCS}/api.md`, "Every endpoint, parameter and error code."],
      ["SDK & CLI", `${DOCS}/sdk.md`, "TypeScript client, browser entry, commands."],
      ["Storage provider", `${DOCS}/storage-provider.md`, "Implement another backend."],
      ["PWA", `${DOCS}/pwa.md`, "Install, offline shell, checks."],
    ],
  },
  {
    icon: ShieldCheck,
    title: "Security",
    items: [
      ["Security model", `${DOCS}/security.md`, "Trust model and controls."],
      ["Limitations", `${DOCS}/limitations.md`, "What is not guaranteed."],
      ["Encryption protocols", `${DOCS}/security/encryption-protocol-v1.md`, "OCE1 and OCE2."],
      ["Disclosure policy", `${REPO}/blob/main/SECURITY.md`, "How to report a vulnerability."],
    ],
  },
  {
    icon: Wrench,
    title: "Clients",
    items: [
      ["Desktop", `${DOCS}/desktop-checklist.md`, "Linux, macOS and Windows checks."],
      ["Desktop uploads", `${DOCS}/desktop-uploads.md`, "Background queue and retries."],
      ["Mobile", `${REPO}/blob/main/apps/mobile/README.md`, "Capacitor shells and builds."],
      ["Evidence", `${REPO}/tree/main/docs/evidence`, "rclone, browser SDK, measurements."],
    ],
  },
] as const;

export function DocsPage() {
  return (
    <InfoLayout
      eyebrow="DOCUMENTATION"
      title="Everything, in one place."
      description="OmniCloud documentation: setup, architecture, API, SDK, security, desktop and mobile clients."
      path="/docs"
      intro="The repository is the source of truth. These are the documents worth reading first — setup, architecture, API, security and client guides."
    >
      <div className="grid gap-6 sm:grid-cols-2">
        {groups.map((group) => (
          <section key={group.title} className="rounded-xl border border-line bg-surface/60 p-5">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              <group.icon className="h-4 w-4 text-gold-text" aria-hidden="true" />
              {group.title}
            </h2>
            <ul className="mt-3 space-y-3">
              {group.items.map(([label, href, body]) => (
                <li key={label}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex items-start gap-2 text-sm font-medium hover:text-gold-text"
                  >
                    {label}
                    <ArrowUpRight
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60"
                      aria-hidden="true"
                    />
                  </a>
                  <p className="muted mt-0.5 text-[12.5px] leading-5">{body}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <section className="rounded-xl border border-line bg-surface/60 p-5">
        <h2 className="text-[15px] font-semibold">On this site</h2>
        <p className="muted mt-2 text-[13px]">
          <a href="/privacy" className="text-gold-text hover:underline">
            Privacy
          </a>{" "}
          ·{" "}
          <a href="/terms" className="text-gold-text hover:underline">
            Terms
          </a>{" "}
          ·{" "}
          <a href="/faq" className="text-gold-text hover:underline">
            FAQ
          </a>{" "}
          ·{" "}
          <a href="/download" className="text-gold-text hover:underline">
            Download
          </a>
        </p>
      </section>
    </InfoLayout>
  );
}
