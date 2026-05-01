export default function Home() {
  return (
    <main className="flex h-full items-center justify-center p-6">
      <div className="border border-[var(--color-hairline)] p-12 text-center">
        <div className="mb-2 text-[var(--text-lg)] text-[var(--color-fg-strong)]">drop a file</div>
        <div className="text-[var(--text-xs)] text-[var(--color-fg-muted)]">
          or click a tool in the sidebar
        </div>
      </div>
    </main>
  );
}
