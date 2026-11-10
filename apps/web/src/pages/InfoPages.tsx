import { InfoLayout } from "../components/InfoLayout";

const H2 = "text-xl font-semibold tracking-tight";
const P = "muted";

export function AboutPage() {
  return (
    <InfoLayout
      eyebrow="ABOUT"
      title="A drive that belongs to you."
      description="OmniCloud is open-source, self-hosted cloud storage backed by a private Telegram channel you control. Built by Hilbras."
      path="/about"
      intro="OmniCloud turns a private Telegram channel into a calm, fast file manager — folders, search, versions, trash, sharing and opt-in client-side encryption — with an open API underneath."
    >
      <section className="space-y-3">
        <h2 className={H2}>Why it exists</h2>
        <p className={P}>
          Cloud drives ask you to trust a vendor with both the bytes and the metadata. OmniCloud
          flips that: your Telegram account is the storage backend, the server runs on your own
          machine, and every line is MIT-licensed. There is no third-party storage vendor in the
          path.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className={H2}>What you get</h2>
        <ul className="muted list-disc space-y-2 ps-5">
          <li>A web drive, a desktop app for Linux, macOS and Windows, an npm SDK and a CLI.</li>
          <li>Folders, search, starred items, recent files, version history and a real Trash.</li>
          <li>Share links and device pairing without exporting keys.</li>
          <li>Opt-in end-to-end encryption, clearly labelled as experimental.</li>
          <li>WebDAV, so rclone and other clients can mount the drive.</li>
        </ul>
      </section>
      <section className="space-y-3">
        <h2 className={H2}>Who builds it</h2>
        <p className={P}>
          OmniCloud is maintained by{" "}
          <a href="https://github.com/Hilbras" className="text-gold-text hover:underline">
            Hilbras
          </a>
          . The repository, issues and release notes live on{" "}
          <a href="https://github.com/Hilbras/OmniCloud" className="text-gold-text hover:underline">
            GitHub
          </a>
          .
        </p>
      </section>
    </InfoLayout>
  );
}

export function PrivacyPage() {
  return (
    <InfoLayout
      eyebrow="PRIVACY"
      title="Privacy, without the small print."
      description="What OmniCloud stores, what it never collects, and which third parties are involved when you use the hosted site."
      path="/privacy"
      intro="The hosted site is a static front end. The drive itself runs on your own server, so most of the data never reaches us at all."
    >
      <section className="space-y-3">
        <h2 className={H2}>This website</h2>
        <ul className="muted list-disc space-y-2 ps-5">
          <li>No analytics, no advertising pixels, no cross-site trackers.</li>
          <li>
            The theme and language preferences are stored in your browser&apos;s local storage; they
            never leave the device.
          </li>
          <li>
            Fonts are served by Google Fonts, which receives your IP address when the page loads.
          </li>
          <li>The site is hosted by Vercel, which keeps standard request logs.</li>
        </ul>
      </section>
      <section className="space-y-3">
        <h2 className={H2}>Your drive</h2>
        <ul className="muted list-disc space-y-2 ps-5">
          <li>
            Files, folders and versions are stored in a private Telegram channel that belongs to
            your account. Telegram is therefore a processor for the bytes.
          </li>
          <li>
            The OmniCloud server stores account metadata, a sealed Telegram session, share-link
            records and (for encrypted files) opaque ciphertext metadata it cannot read.
          </li>
          <li>
            With client-side encryption enabled, file contents and (for OCE2) names are encrypted on
            your device. Keys never reach the server.
          </li>
        </ul>
      </section>
      <section className="space-y-3">
        <h2 className={H2}>Deleting data</h2>
        <p className={P}>
          Deleting a file removes its metadata and the stored object. Revoking a token or signing
          out ends the session immediately. Because the software is self-hosted, the operator of
          your instance controls backups and retention.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className={H2}>Contact</h2>
        <p className={P}>
          Privacy questions can be raised in the{" "}
          <a
            href="https://github.com/Hilbras/OmniCloud/issues"
            className="text-gold-text hover:underline"
          >
            public issue tracker
          </a>
          .
        </p>
      </section>
    </InfoLayout>
  );
}

export function TermsPage() {
  return (
    <InfoLayout
      eyebrow="TERMS"
      title="Terms of use."
      description="The licence, the warranty disclaimer, and the rules for using the hosted OmniCloud site."
      path="/terms"
      intro="OmniCloud is free, open-source software released under the MIT licence. These terms cover the hosted website and the project's public services."
    >
      <section className="space-y-3">
        <h2 className={H2}>Licence</h2>
        <p className={P}>
          The source code is licensed under the MIT licence. You may use, copy, modify, merge,
          publish, distribute, sublicense and sell copies, provided the copyright notice and
          permission notice are included.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className={H2}>No warranty</h2>
        <p className={P}>
          The software is provided &ldquo;as is&rdquo;, without warranty of any kind, express or
          implied, including merchantability, fitness for a particular purpose and non-infringement.
          You are responsible for your own backups and for the security of the machine that runs
          your instance.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className={H2}>Acceptable use</h2>
        <ul className="muted list-disc space-y-2 ps-5">
          <li>Do not use the hosted site to break the law or infringe others&apos; rights.</li>
          <li>
            You must own, or be allowed to use, the Telegram account you connect. Telegram&apos;s
            own terms apply to the storage it provides.
          </li>
          <li>Do not attempt to disrupt the hosted site or other users&apos; access to it.</li>
        </ul>
      </section>
      <section className="space-y-3">
        <h2 className={H2}>Changes</h2>
        <p className={P}>
          These terms may change with the project. Material changes are recorded in the repository.
          Continuing to use the hosted site after a change means you accept the updated terms.
        </p>
      </section>
    </InfoLayout>
  );
}

export function FaqPage() {
  const items = [
    {
      q: "Where are my files actually stored?",
      a: "In a private Telegram channel created for your account. OmniCloud stores only metadata and the sealed Telegram session on its own server.",
    },
    {
      q: "Is it free?",
      a: "Yes. The software is MIT-licensed and self-hosted. You pay only for the machine that runs it, and Telegram's own storage limits apply.",
    },
    {
      q: "Is encryption on by default?",
      a: "No. Encryption is opt-in and marked experimental. When enabled, files are encrypted on your device with keys that never reach the server.",
    },
    {
      q: "Can I use it without the web app?",
      a: "Yes. There is a desktop app, an npm SDK, a CLI, and WebDAV for clients such as rclone.",
    },
    {
      q: "What happens if I lose my key?",
      a: "Encrypted files cannot be recovered without the root key. The recovery code created when you enable encryption is the fallback — store it offline.",
    },
    {
      q: "Does it work on mobile?",
      a: "The web app works in a mobile browser. A native mobile client is on the roadmap, not shipped yet.",
    },
  ];
  return (
    <InfoLayout
      eyebrow="FAQ"
      title="Questions, answered."
      description="Common questions about OmniCloud: storage, pricing, encryption, clients, key recovery and mobile support."
      path="/faq"
      intro="Short answers to the things people ask before running OmniCloud."
    >
      <div className="space-y-6">
        {items.map((item) => (
          <section key={item.q} className="space-y-2">
            <h2 className={H2}>{item.q}</h2>
            <p className={P}>{item.a}</p>
          </section>
        ))}
      </div>
    </InfoLayout>
  );
}
