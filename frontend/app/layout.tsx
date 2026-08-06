import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sherlock OSINT",
  description: "OSINT investigation pipeline",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <nav className="topbar">
          <span className="brand">🔍 Sherlock OSINT</span>
          <Link href="/">Cases</Link>
          <Link href="/audit">Audit</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
