import Link from "next/link";
import { EnginesTable } from "./engines-table";

const GITHUB_URL = "https://github.com/tonyyu2170/file-converter";

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-[720px] p-6">
      <h1 className="mb-12 font-medium text-[40px] leading-[1.0] md:text-[var(--text-display)]">
        <span className="block text-[var(--color-fg-strong)]">files</span>
        <span className="block text-[var(--color-fg-muted)]">never leave</span>
        <span className="block text-[var(--color-accent)]">your device.</span>
      </h1>

      <Section heading="why this exists">
        <p>
          common file conversions today require uploading personal documents to ad-supported
          third-party sites of unknown provenance. this site does the conversion entirely in the
          browser, so no file ever traverses the network.
        </p>
      </Section>

      <Section heading="verify it yourself">
        <ol className="ml-5 list-decimal space-y-1 text-[var(--text-sm)] text-[var(--color-fg-muted)] leading-relaxed">
          <li>open devtools (cmd+option+i on macos, f12 on windows/linux).</li>
          <li>switch to the network tab.</li>
          <li>set the filter to &ldquo;fetch/xhr&rdquo;.</li>
          <li>drop a file in any tool on this site.</li>
          <li>click convert.</li>
          <li>observe: zero new requests during conversion.</li>
        </ol>
        <p className="mt-3 text-[var(--text-sm)] text-[var(--color-fg-very-muted)] leading-relaxed">
          page-load assets show on first visit and are then cached. nothing is fetched during the
          actual conversion step.
        </p>
      </Section>

      <Section heading="how it works">
        <ul className="ml-5 list-disc space-y-2 text-[var(--text-sm)] text-[var(--color-fg-muted)] leading-relaxed">
          <li>
            <strong className="text-[var(--color-fg-strong)]">static export.</strong> no server
            runtime — the entire site is html / js / css / wasm served from a cdn.
          </li>
          <li>
            <strong className="text-[var(--color-fg-strong)]">web worker per conversion.</strong>{" "}
            conversion code runs off the main thread; large files don&apos;t freeze the tab.
          </li>
          <li>
            <strong className="text-[var(--color-fg-strong)]">strict csp.</strong>{" "}
            <code className="text-[var(--color-accent)]">connect-src &apos;self&apos;</code> makes
            off-origin fetches structurally impossible — not a promise, an enforced header.
          </li>
        </ul>
      </Section>

      <Section heading="engines">
        <EnginesTable />
      </Section>

      <Section heading="source">
        <p className="text-[var(--text-sm)] text-[var(--color-fg-muted)]">
          <Link
            href={GITHUB_URL}
            className="text-[var(--color-accent)] underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer noopener"
          >
            {GITHUB_URL.replace(/^https:\/\//, "")}
          </Link>
        </p>
      </Section>
    </main>
  );
}

function Section({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-accent)]">
        [ {heading} ]
      </h2>
      <div className="space-y-2 text-[var(--text-sm)] text-[var(--color-fg-muted)] leading-relaxed">
        {children}
      </div>
    </section>
  );
}
