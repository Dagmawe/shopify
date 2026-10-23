import type { ReactNode } from "react";
import styles from "../styles/site.module.css";

// Fonts for the public pages only (the app inside Shopify uses Shopify's own).
export const siteFontLinks = [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" as const },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600&family=Young+Serif&display=swap",
  },
];

export function CorkMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="15" fill="#1e3b30" />
      <circle cx="16" cy="16" r="11" fill="#c49a6c" />
      <circle cx="16" cy="16" r="6.5" fill="none" stroke="#9c7445" strokeWidth="1.2" />
    </svg>
  );
}

export function SitePage({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <div className={styles.wrap}>
        <header className={styles.header}>
          <a className={styles.brand} href="/">
            <CorkMark className={styles.brandMark} />
            Corkcount
          </a>
          <a className={styles.navLink} href="/privacy">
            Privacy
          </a>
        </header>
        {children}
        <footer className={styles.footer}>
          <span>Corkcount is an app for Shopify stores, made by Dagmawe Legesse.</span>
          <a href="/privacy">Privacy policy</a>
        </footer>
      </div>
    </div>
  );
}
