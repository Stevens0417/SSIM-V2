"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import AuthModal from "@/components/auth/AuthModal";
import Sidebar from "./Sidebar";
import styles from "@/app/layout.module.css";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const isAuthPage = pathname.startsWith("/auth");

  // Standalone /auth page renders without shell
  if (isAuthPage) {
    return <>{children}</>;
  }

  // While checking auth, render nothing to prevent flash
  if (loading) {
    return null;
  }

  // Not authenticated — show modal over blank page
  if (!user) {
    return <AuthModal />;
  }

  return (
    <div className={styles.shell}>
      <div className="no-print">
        <Sidebar />
      </div>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
