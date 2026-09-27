import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import { ADSENSE, SITE, TOPICS } from "@/blog.config";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: SITE.name, template: `%s | ${SITE.name}` },
  description: SITE.description,
  openGraph: { siteName: SITE.name, locale: SITE.locale, type: "website" },
  alternates: { types: { "application/rss+xml": "/feed.xml" } },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        {ADSENSE.client && (
          <Script
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE.client}`}
            crossOrigin="anonymous"
            strategy="afterInteractive"
          />
        )}
        <header className="site-header">
          <div className="container header-inner">
            <Link href="/" className="logo">
              {SITE.name}
            </Link>
            <nav className="nav">
              {TOPICS.map((t) => (
                <Link key={t.slug} href={`/topics/${t.slug}`}>
                  {t.name}
                </Link>
              ))}
              <Link href="/about">소개</Link>
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
        <footer className="site-footer">
          <div className="container footer-inner">
            <span>
              © {new Date().getFullYear()} {SITE.name}
            </span>
            <nav className="nav">
              <Link href="/about">소개</Link>
              <Link href="/privacy">개인정보처리방침</Link>
              <a href="/feed.xml">RSS</a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
