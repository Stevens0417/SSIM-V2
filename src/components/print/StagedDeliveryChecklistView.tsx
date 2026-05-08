"use client";

import { fmtPackageType } from "@/lib/fmt";
import styles from "./StagedDeliveryChecklistView.module.css";

export interface ChecklistRow {
  customerId: string;
  customerName: string;
  farmName: string;
  stagedDeliveryId: string;
  stagedDate: string;
  product: string;
  treatment: string;
  seedSize: string | null;
  packageType: string;
  unitsStaged: number;
  notes: string;
}

export interface ChecklistData {
  printDate: string;
  seasonYear: number | null;
  totalDeliveries: number;
  totalUnits: number;
  rows: ChecklistRow[];
}

function fmtDate(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts.map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${d}, ${y}`;
}

export default function StagedDeliveryChecklistView({ data }: { data: ChecklistData }) {
  // Group rows by customerId, preserving pre-sorted order (customer name sort)
  const customerIds: string[] = [];
  const groups = new Map<string, ChecklistRow[]>();
  for (const row of data.rows) {
    if (!groups.has(row.customerId)) {
      customerIds.push(row.customerId);
      groups.set(row.customerId, []);
    }
    groups.get(row.customerId)!.push(row);
  }

  return (
    <div className={styles.checklist}>
      {/* ---- Header ---- */}
      <div className={styles.header}>
        <div className={styles.headerTitle}>Staged Deliveries — In Progress Checklist</div>
        <div className={styles.headerSub}>Stevens Seeds</div>
        <div className={styles.headerMeta}>
          <span>Printed: {fmtDate(data.printDate)}</span>
          {data.seasonYear && <span>Season: {data.seasonYear}</span>}
          <span>
            {data.totalDeliveries} staged{" "}
            {data.totalDeliveries === 1 ? "delivery" : "deliveries"}
          </span>
          <span>
            Total units: <strong>{data.totalUnits}</strong>
          </span>
        </div>
      </div>

      {/* ---- Customer groups ---- */}
      {customerIds.map((cid) => {
        const groupRows = groups.get(cid)!;
        const first = groupRows[0];
        const subtotal = groupRows.reduce((s, r) => s + r.unitsStaged, 0);
        const displayName = first.farmName
          ? `${first.farmName} — ${first.customerName}`
          : first.customerName;

        return (
          <div key={cid} className={styles.customerGroup}>
            <div className={styles.customerHeader}>
              <span className={styles.customerName}>{displayName}</span>
              <span className={styles.customerSubtotal}>
                {subtotal} unit{subtotal !== 1 ? "s" : ""}
              </span>
            </div>

            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.colCheck}>✓</th>
                  <th className={styles.colDate}>Date</th>
                  <th className={styles.colProduct}>Product</th>
                  <th className={styles.colTreatment}>Treatment</th>
                  <th className={styles.colSize}>Size</th>
                  <th className={styles.colPkg}>Pkg</th>
                  <th className={styles.colUnits}>Units</th>
                  <th className={styles.colNotes}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {groupRows.map((r, i) => (
                  <tr key={i}>
                    <td className={styles.colCheck}>
                      <span className={styles.checkbox} />
                    </td>
                    <td className={styles.colDate}>{fmtDate(r.stagedDate)}</td>
                    <td className={styles.colProduct}>{r.product}</td>
                    <td className={styles.colTreatment}>{r.treatment}</td>
                    <td className={styles.colSize}>{r.seedSize ?? "—"}</td>
                    <td className={styles.colPkg}>{fmtPackageType(r.packageType)}</td>
                    <td className={styles.colUnits}>{r.unitsStaged}</td>
                    <td className={styles.colNotes}>{r.notes}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={styles.subtotalRow}>
                  <td colSpan={6} className={styles.subtotalLabel}>
                    Subtotal
                  </td>
                  <td className={styles.colUnits}>{subtotal}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })}

      {/* ---- Grand total ---- */}
      <div className={styles.grandTotal}>
        Grand Total: <strong>{data.totalUnits}</strong> unit
        {data.totalUnits !== 1 ? "s" : ""} across {data.totalDeliveries} staged{" "}
        {data.totalDeliveries === 1 ? "delivery" : "deliveries"}
      </div>
    </div>
  );
}
