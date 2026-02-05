"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./Sidebar.module.css";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/pricing", label: "Pricing" },
  { href: "/orders", label: "Orders" },
  { href: "/deliveries", label: "Deliveries" },
  { href: "/returns", label: "Returns" },
  { href: "/replants", label: "Replants" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close drawer on ESC key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      setOpen(false);
    }
  }, [open]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      document.addEventListener("keydown", handleKeyDown);
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, handleKeyDown]);

  const closeDrawer = () => setOpen(false);

  return (
    <>
      {/* ---- Mobile Top Bar ---- */}
      <div className={styles.mobileTopBar}>
        <span className={styles.mobileTopLogo}>SSIM</span>
        <button
          className={styles.hamburger}
          onClick={() => setOpen(true)}
          aria-label="Open menu"
        >
          <span className={styles.bar} />
          <span className={styles.bar} />
          <span className={styles.bar} />
        </button>
      </div>

      {/* ---- Mobile Drawer Overlay ---- */}
      {open && (
        <div
          className={styles.overlay}
          onClick={closeDrawer}
          aria-hidden="true"
        />
      )}

      {/* ---- Mobile Drawer ---- */}
      <aside
        className={`${styles.drawer} ${open ? styles.drawerOpen : ""}`}
        aria-hidden={!open}
      >
        <div className={styles.drawerHeader}>
          <span className={styles.drawerTitle}>Menu</span>
          <button
            className={styles.drawerClose}
            onClick={closeDrawer}
            aria-label="Close menu"
          >
            ×
          </button>
        </div>
        <nav className={styles.drawerNav}>
          {NAV_ITEMS.map(({ href, label }) => {
            const isActive =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`${styles.drawerLink} ${isActive ? styles.drawerLinkActive : ""}`}
                onClick={closeDrawer}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* ---- Desktop Sidebar ---- */}
      <aside className={styles.sidebar}>
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
