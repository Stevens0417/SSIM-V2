import type { Metadata, Viewport } from "next";
import Sidebar from "@/components/layout/Sidebar";
import "./globals.css";
import styles from "./layout.module.css";

export const metadata: Metadata = {
  title: "SSIM",
  description: "Seed Sales & Inventory Manager",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className={styles.shell}>
          <div className="no-print">
            <Sidebar />
          </div>
          <main className={styles.main}>{children}</main>
        </div>
      </body>
    </html>
  );
}
