"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { OrderItemViewRow } from "@/services/order.service";
import styles from "./OrderItemsListTable.module.css";

function fmt(n: number): string {
  return n.toFixed(2);
}

type FilterKey =
  | "order_date"
  | "customer_name"
  | "product_name"
  | "treatment_name"
  | "brand_grower_pct"
  | "early_pay_pct";

type Filters = Record<FilterKey, string | null>;

const EMPTY_FILTERS: Filters = {
  order_date: null,
  customer_name: null,
  product_name: null,
  treatment_name: null,
  brand_grower_pct: null,
  early_pay_pct: null,
};

interface Props {
  rows: OrderItemViewRow[];
  loading: boolean;
  error: string | null;
  onEdit: (orderId: string) => void;
  onDelete: (orderId: string) => void;
}

/* ---- Inline filter dropdown ---- */

function FilterDropdown({
  options,
  value,
  onChange,
  onClose,
}: {
  options: string[];
  value: string | null;
  onChange: (v: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div className={styles.filterDropdown} ref={ref}>
      <div
        className={`${styles.filterOption} ${value === null ? styles.filterOptionActive : ""}`}
        onClick={() => {
          onChange(null);
          onClose();
        }}
      >
        All
      </div>
      {options.map((opt) => (
        <div
          key={opt}
          className={`${styles.filterOption} ${value === opt ? styles.filterOptionActive : ""}`}
          onClick={() => {
            onChange(opt);
            onClose();
          }}
        >
          {opt}
        </div>
      ))}
    </div>
  );
}

/* ---- Filterable header cell ---- */

function FilterableTh({
  label,
  filterKey,
  filters,
  setFilters,
  distinctValues,
  className,
}: {
  label: string;
  filterKey: FilterKey;
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  distinctValues: string[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const isActive = filters[filterKey] !== null;

  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <th className={`${className ?? ""} ${styles.filterableTh}`}>
      <span className={styles.thContent}>
        {label}
        <button
          className={`${styles.filterBtn} ${isActive ? styles.filterBtnActive : ""}`}
          onClick={() => setOpen((p) => !p)}
          title={`Filter ${label}`}
        >
          &#9662;
        </button>
      </span>
      {open && (
        <FilterDropdown
          options={distinctValues}
          value={filters[filterKey]}
          onChange={(v) => setFilters((prev) => ({ ...prev, [filterKey]: v }))}
          onClose={handleClose}
        />
      )}
    </th>
  );
}

/* ---- Main component ---- */

export default function OrderItemsListTable({
  rows,
  loading,
  error,
  onEdit,
  onDelete,
}: Props) {
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS });

  // Distinct values per filterable column (computed from all rows, not filtered rows)
  const distinctValues = useMemo(() => {
    const sets: Record<FilterKey, Set<string>> = {
      order_date: new Set(),
      customer_name: new Set(),
      product_name: new Set(),
      treatment_name: new Set(),
      brand_grower_pct: new Set(),
      early_pay_pct: new Set(),
    };
    for (const r of rows) {
      sets.order_date.add(r.order_date);
      sets.customer_name.add(r.customer_name);
      sets.product_name.add(r.product_name);
      sets.treatment_name.add(r.treatment_name);
      sets.brand_grower_pct.add(String(r.brand_grower_pct));
      sets.early_pay_pct.add(String(r.early_pay_pct));
    }
    const sortAsc = (s: Set<string>) => Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const sortDesc = (s: Set<string>) => Array.from(s).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return {
      order_date: sortDesc(sets.order_date),
      customer_name: sortAsc(sets.customer_name),
      product_name: sortAsc(sets.product_name),
      treatment_name: sortAsc(sets.treatment_name),
      brand_grower_pct: sortAsc(sets.brand_grower_pct),
      early_pay_pct: sortAsc(sets.early_pay_pct),
    };
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filters.order_date !== null && r.order_date !== filters.order_date) return false;
      if (filters.customer_name !== null && r.customer_name !== filters.customer_name) return false;
      if (filters.product_name !== null && r.product_name !== filters.product_name) return false;
      if (filters.treatment_name !== null && r.treatment_name !== filters.treatment_name) return false;
      if (filters.brand_grower_pct !== null && String(r.brand_grower_pct) !== filters.brand_grower_pct) return false;
      if (filters.early_pay_pct !== null && String(r.early_pay_pct) !== filters.early_pay_pct) return false;
      return true;
    });
  }, [rows, filters]);

  const hasActiveFilters = Object.values(filters).some((v) => v !== null);

  if (loading) return <div className={styles.status}>Loading order items…</div>;
  if (error) return <div className={styles.error}>{error}</div>;

  return (
    <div>
      {hasActiveFilters && (
        <div className={styles.filterBar}>
          <button
            className={styles.clearFiltersBtn}
            onClick={() => setFilters({ ...EMPTY_FILTERS })}
          >
            Clear filters
          </button>
        </div>
      )}

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
                <th>Order ID</th>
                <FilterableTh label="Date" filterKey="order_date" filters={filters} setFilters={setFilters} distinctValues={distinctValues.order_date} />
                <FilterableTh label="Customer" filterKey="customer_name" filters={filters} setFilters={setFilters} distinctValues={distinctValues.customer_name} />
                <FilterableTh label="Product" filterKey="product_name" filters={filters} setFilters={setFilters} distinctValues={distinctValues.product_name} />
                <FilterableTh label="Treatment" filterKey="treatment_name" filters={filters} setFilters={setFilters} distinctValues={distinctValues.treatment_name} />
                <th className={styles.right}>Units</th>
                <th className={styles.right}>Retail $/U</th>
                <FilterableTh label="BG %" filterKey="brand_grower_pct" filters={filters} setFilters={setFilters} distinctValues={distinctValues.brand_grower_pct} className={styles.center} />
                <FilterableTh label="EP %" filterKey="early_pay_pct" filters={filters} setFilters={setFilters} distinctValues={distinctValues.early_pay_pct} className={styles.center} />
                <th className={styles.right}>Line Total</th>
                <th className={styles.right}>Profit</th>
                <th className={styles.center}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.order_item_id}>
                  <td className={styles.orderId}>{r.order_id.slice(0, 8)}</td>
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
