"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import styles from "./Sidebar.module.css";

const NAV_SECTIONS = [
  {
    label: "Agent",
    items: [
      { href: "/agent", label: "Chat" },
    ],
  },
  {
    label: "Tools",
    items: [
      { href: "/", label: "Dashboard" },
      { href: "/pricing", label: "Pricing" },
      { href: "/adjustments", label: "Adjustments" },
      { href: "/on-hand-inventory", label: "On-Hand Inventory" },
    ],
  },
  {
    label: "Forms",
    items: [
      { href: "/orders", label: "Orders" },
      { href: "/staged-deliveries", label: "Staged Deliveries" },
      { href: "/deliveries", label: "Deliveries" },
      { href: "/returns", label: "Returns" },
      { href: "/replants", label: "Replants" },
      { href: "/bayer-shipments", label: "Bayer Shipments" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/customers", label: "Customers" },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { signOut } = useAuth();
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
        <Image
          src="/assets/logos/logo-horizontal.png"
          alt="Stevens Seeds Inventory Management"
          width={180}
          height={40}
          className={styles.mobileTopLogoImg}
          style={{ objectFit: "contain", height: "36px", width: "auto" }}
          priority
        />
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
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <div className={styles.drawerSectionHeader}>{section.label}</div>
              {section.items.map(({ href, label }) => {
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
            </div>
          ))}
        </nav>
        <div className={styles.drawerFooter}>
          <button className={styles.drawerSignOut} onClick={signOut}>
            Sign Out
          </button>
        </div>
      </aside>

      {/* ---- Desktop Sidebar ---- */}
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          <Image
            src="/assets/logos/logo-main.png"
            alt="Stevens Seeds Inventory Management"
            width={180}
            height={80}
            className={styles.logoImg}
            style={{ objectFit: "contain", width: "100%", height: "auto", maxHeight: "80px" }}
            priority
          />
        </div>
        <nav className={styles.nav}>
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <div className={styles.sectionHeader}>{section.label}</div>
              {section.items.map(({ href, label }) => {
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
            </div>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <button className={styles.signOut} onClick={signOut}>
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}
