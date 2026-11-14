import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/AppShell";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agento",
  description: "Agents that spend USDC only on what you approved.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fcfcfb",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <header className="sticky top-0 z-30 border-b border-line/70 bg-surface/75 backdrop-blur-md">
          <div className="mx-auto flex min-h-14 max-w-6xl items-center justify-between px-5 pt-[env(safe-area-inset-top)]">
            <Link href="/" className="group flex items-center gap-2 text-[15px] font-semibold tracking-tight">
              <span className="relative inline-flex h-6 w-6 items-center justify-center rounded-lg bg-ink text-[11px] font-bold text-white transition-transform group-hover:-rotate-6">
                a
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-agent ring-2 ring-panel" />
              </span>
              agento
            </Link>
            <nav className="hidden items-center gap-4 text-sm text-ink-2 sm:flex">
              <Link href="/" className="hover:text-ink">
                Jobs
              </Link>
              <Link href="/agents" className="hover:text-ink">
                Agents
              </Link>
              <Link href="/new" className="pix-press rounded-lg border border-ink bg-ink px-3 py-1.5 text-white">
                + New job
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-5 sm:py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-5 pb-[calc(var(--tabbar-h)+24px)] pt-4 text-[12px] text-ink-3 sm:pb-10">
          Runs on Arc testnet · USDC for value and gas · x402 pay-per-request · spend rules enforced by a vault contract
        </footer>
        <AppShell />
      </body>
    </html>
  );
}
