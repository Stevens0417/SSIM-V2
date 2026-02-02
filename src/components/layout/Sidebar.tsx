"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./Sidebar.module.css";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/pricing", label: "Pricing" },
  { href: "/orders", label: "Orders" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className={styles.hamburger}
        onClick={() => setOpen((v) => !v)}
        aria-label="Toggle navigation"
      >
        <span className={styles.bar} />
        <span className={styles.bar} />
        <span className={styles.bar} />
      </button>

      {open && (
        <div className={styles.overlay} onClick={() => setOpen(false)} />
      )}

      <aside className={`${styles.sidebar} ${open ? styles.open : ""}`}>
        <div className={styles.logo}>SSIM</div>
        <nav className={styles.nav}>
          {NAV_ITEMS.map(({ href, label }) => {
            const isActive =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`${styles.link} ${isActive ? styles.active : ""}`}
                onClick={() => setOpen(false)}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
