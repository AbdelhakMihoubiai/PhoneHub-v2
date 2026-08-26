import type { Metadata, Viewport } from "next";
import Link from "next/link";
import ScrollProgress from "@/components/ScrollProgress";
import "./globals.css";

export const metadata: Metadata = {
  title: "Phone Information Hub",
  description:
    "Live smartphone specifications sourced from public APIs, open datasets and the web — always attributed.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <ScrollProgress />
        <header className="border-b border-[var(--color-border)]/60 backdrop-blur sticky top-0 z-20 bg-[#070b12]/85">
          <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
            <Link href="/" className="font-bold tracking-tight text-lg" aria-label="PhoneHub home">
              📱 Phone<span className="gradient-text">Hub</span>
            </Link>
            <nav className="flex gap-4 sm:gap-6 text-sm text-slate-300">
              <Link href="/" className="hover:text-white transition-colors py-2">Search</Link>
              <Link href="/admin" className="hover:text-white transition-colors py-2">Admin</Link>
            </nav>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-6 sm:py-8">{children}</main>
        <footer className="max-w-6xl mx-auto px-4 py-10 text-xs text-slate-500 leading-relaxed border-t border-[var(--color-border)]/40 mt-10">
          Data is retrieved live from public APIs, open datasets and robots-compliant web research.
          Every field shows its source and confidence level. Unverifiable data is shown as
          &quot;Not available&quot; — never invented.
        </footer>
      </body>
    </html>
  );
}
