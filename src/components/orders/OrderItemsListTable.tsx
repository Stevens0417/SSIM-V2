"use client";

import { useState, useMemo } from "react";
import type { OrderItemViewRow } from "@/services/order.service";
import styles from "./OrderItemsListTable.module.css";

function fmt(n: number): string {
  return n.toFixed(2);
}

interface Props {
  rows: OrderItemViewRow[];
  loading: boolean;
  error: string | null;
  onEdit: (orderId: string) => void;
  onDelete: (orderId: string) => void;
}

export default function OrderItemsListTable({
  rows,
  loading,
  error,
  onEdit,
  onDelete,
}: Props) {
  const [searchTerm, setSearchTerm] = useState("");

  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return rows;
    const term = searchTerm.toLowerCase();
    return rows.filter(
      (r) =>
        r.customer_name.toLowerCase().includes(term) ||
        r.product_name.toLowerCase().includes(term) ||
        r.treatment_name.toLowerCase().includes(term)
    );
  }, [rows, searchTerm]);

  if (loading) return <div className={styles.status}>Loading order items…</div>;
  if (error) return <div className={styles.error}>{error}</div>;

  return (
    <div>
      {/* Search input */}
      <div className={styles.searchBar}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Filter by customer, product, or treatment…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {searchTerm && (
          <button
            className={styles.clearSearchBtn}
            onClick={() => setSearchTerm("")}
          >
            ×
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className={styles.status}>
          {rows.length === 0
            ? "No orders found for this season."
            : "No matching items."}
        </div>
      ) : (
        <div className={styles.wrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Customer</th>
                <th>Product</th>
                <th>Treatment</th>
                <th className={styles.right}>Units</th>
                <th className={styles.right}>Retail $/U</th>
                <th className={styles.center}>BG %</th>
                <th className={styles.center}>EP %</th>
                <th className={styles.right}>Line Total</th>
                <th className={styles.right}>Profit</th>
                <th>Notes</th>
                <th className={styles.center}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.order_item_id}>
                  <td>{r.order_date}</td>
                  <td>{r.customer_name}</td>
                  <td>{r.product_name}</td>
                  <td>{r.treatment_name}</td>
                  <td className={styles.mono}>{r.units}</td>
                  <td className={styles.mono}>${fmt(r.retail_price_per_unit)}</td>
                  <td className={styles.center}>{r.brand_grower_pct}</td>
                  <td className={styles.center}>{r.early_pay_pct}</td>
                  <td className={styles.mono}>
                    ${fmt(r.line_total_after_all_discounts)}
                  </td>
                  <td
                    className={`${styles.mono} ${
                      r.line_total_profit >= 0
                        ? styles.positive
                        : styles.negative
                    }`}
                  >
                    ${fmt(r.line_total_profit)}
                  </td>
                  <td className={styles.notes}>{r.notes || "—"}</td>
                  <td className={styles.center}>
                    <span className={styles.actionGroup}>
                      <button
                        className={styles.editBtn}
                        onClick={() => onEdit(r.order_id)}
                      >
                        Edit
                      </button>
                      <button
                        className={styles.deleteBtn}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete this order for ${r.customer_name}?`
                            )
                          ) {
                            onDelete(r.order_id);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
