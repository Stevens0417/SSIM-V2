"use client";

import type { OrderSummaryRow } from "@/services/order.service";
import styles from "./SeasonOrdersTable.module.css";

function fmt(n: number): string {
  return n.toFixed(2);
}

interface Props {
  orders: OrderSummaryRow[];
  loading: boolean;
  error: string | null;
  onEdit: (orderId: string) => void;
}

export default function SeasonOrdersTable({ orders, loading, error, onEdit }: Props) {
  if (loading) return <div className={styles.status}>Loading orders…</div>;
  if (error) return <div className={styles.error}>{error}</div>;
  if (orders.length === 0) return <div className={styles.status}>No orders found for this season.</div>;

  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Customer</th>
            <th className={styles.right}>Units</th>
            <th className={styles.right}>Total</th>
            <th className={styles.right}>Profit</th>
            <th className={styles.center}>BG %</th>
            <th className={styles.center}>EP %</th>
            <th className={styles.center}>Action</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>{o.order_date}</td>
              <td>{o.customer_name}</td>
              <td className={styles.mono}>{o.total_units}</td>
              <td className={styles.mono}>${fmt(o.total_after_all_discounts)}</td>
              <td className={`${styles.mono} ${o.total_profit >= 0 ? styles.positive : styles.negative}`}>
                ${fmt(o.total_profit)}
              </td>
              <td className={styles.center}>{o.brand_grower_pct}</td>
              <td className={styles.center}>{o.early_pay_pct}</td>
              <td className={styles.center}>
                <button className={styles.editBtn} onClick={() => onEdit(o.id)}>
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
