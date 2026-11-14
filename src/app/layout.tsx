import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agento",
  description: "Agents that spend USDC only on what you approved.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <header className="border-b border-line bg-panel/80 backdrop-blur sticky top-0 z-30">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
            <Link href="/" className="text-[15px] font-semibold tracking-tight">
              agento
            </Link>
            <nav className="flex gap-5 text-sm text-ink-2">
              <Link href="/" className="hover:text-ink">
                New job
              </Link>
              <Link href="/history" className="hover:text-ink">
                History
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
      </body>
    </html>
  );
}
