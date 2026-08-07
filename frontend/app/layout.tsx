import type { Metadata } from "next";
import Link from "next/link";
import { Fira_Sans, Fira_Code } from "next/font/google";
import { Icon } from "./_components/icon";
import { InflightProvider } from "@/components/global-progress";
import "./globals.css";

const firaSans = Fira_Sans({
  variable: "--font-fira-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const firaCode = Fira_Code({
  variable: "--font-fira-code",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sherlock OSINT",
  description: "OSINT investigation pipeline — collectors, correlation, review, and report.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${firaSans.variable} ${firaCode.variable}`}>
      <body>
        <InflightProvider>
        <nav className="topbar">
          <Link href="/" className="brand">
            <Icon name="search" size={18} />
            <span>Sherlock</span>
            <span className="muted" style={{ fontSize: 11, fontWeight: 400, marginLeft: 4, opacity: 0.6 }}>
              OSINT
            </span>
          </Link>
          <div className="nav-links">
            <Link href="/">Cases</Link>
            <Link href="/audit">Audit</Link>
          </div>
          <span className="status-pill">
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "var(--color-accent)", marginRight: 6 }} />
            live
          </span>
        </nav>
        <main>{children}</main>
        </InflightProvider>
      </body>
    </html>
  );
}
