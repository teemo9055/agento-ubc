import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import { AppShell, MainNav } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
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
  themeColor: "#fafaf8",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-md">
          <div className="mx-auto flex min-h-16 max-w-6xl items-center gap-4 px-4 pt-[env(safe-area-inset-top)] sm:px-6">
            <Link href="/home" aria-label="Agento home" className="group flex items-center gap-2.5 text-[16px] font-bold tracking-tight">
              <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-[7px] bg-ink font-pixel text-[14px] text-white transition-transform group-hover:-rotate-6">
                a
                <span className="absolute -right-[3px] -top-[3px] h-[9px] w-[9px] rounded-[2px] border-2 border-surface bg-agent" />
              </span>
              agento
            </Link>
            <MainNav />
            <div className="flex-1" />
            <Link href="/new" className="pix-press hidden h-10 items-center gap-2 rounded-lg border-[1.5px] border-ink bg-ink px-4 text-sm font-semibold text-white sm:inline-flex">
              <Icon name="plus" size={16} stroke={2.2} />
              New job
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 sm:px-6 pb-[calc(var(--tabbar-h)+24px)] pt-4 text-[12px] text-ink-3 sm:pb-10">
          Runs on Arc · pays per request in USDC · spending rules enforced on-chain
        </footer>
        <AppShell />
      </body>
    </html>
  );
}
