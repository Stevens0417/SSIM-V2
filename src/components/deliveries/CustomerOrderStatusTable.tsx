"use client";

import type { CustomerOrderStatusRow } from "@/services/delivery.service";
import styles from "./CustomerOrderStatusTable.module.css";

interface Props {
  rows: CustomerOrderStatusRow[];
  loading: boolean;
  error: string | null;
}

interface OrderGroup {
  order_id: string;
  order_date: string;
  lines: CustomerOrderStatusRow[];
}

function groupByOrder(rows: CustomerOrderStatusRow[]): OrderGroup[] {
  const map = new Map<string, OrderGroup>();
  for (const row of rows) {
    if (!map.has(row.order_id)) {
      map.set(row.order_id, {
        order_id: row.order_id,
        order_date: row.order_date,
        lines: [],
      });
    }
    map.get(row.order_id)!.lines.push(row);
  }
  return Array.from(map.values());
}

export default function CustomerOrderStatusTable({
  rows,
  loading,
  error,
}: Props) {
  return (
    <>
      <div className={styles.sectionHeader}>Customer Order Status</div>
      {loading ? (
        <div className={styles.status}>Loading…</div>
      ) : error ? (
        <div className={styles.error}>{error}</div>
      ) : rows.length === 0 ? (
        <div className={styles.status}>No orders found for this customer.</div>
      ) : (
        <div className={styles.groups}>
          {groupByOrder(rows).map((group) => (
            <div key={group.order_id} className={styles.group}>
              <div className={styles.orderHeader}>
                <span className={styles.orderDate}>{group.order_date}</span>
                <span className={styles.orderId}>#{group.order_id.slice(0, 8)}</span>
              </div>
              <div className={styles.wrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Treatment</th>
                      <th className={styles.center}>Size</th>
                      <th className={styles.center}>Ordered</th>
                      <th className={styles.center}>Delivered</th>
                      <th className={styles.center}>Returned</th>
                      <th className={styles.center}>Net Units</th>
                      <th className={styles.center}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.lines.map((row, i) => {
                      const netUnits =
                        row.ordered_units - row.delivered_units + row.returned_units;
                      const isComplete = netUnits <= 0;
                      return (
                        <tr key={`${row.order_id}-${i}`}>
                          <td>{row.product_name}</td>
                          <td>{row.treatment_name}</td>
                          <td className={styles.center}>{row.seed_size || "—"}</td>
                          <td className={styles.center}>{row.ordered_units}</td>
                          <td className={styles.center}>{row.delivered_units}</td>
                          <td className={styles.center}>{row.returned_units}</td>
                          <td className={styles.center}>{netUnits}</td>
                          <td className={styles.center}>
                            <span
                              className={
                                isComplete ? styles.badgeComplete : styles.badgeOpen
                              }
                            >
                              {isComplete ? "Complete" : "Open"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
