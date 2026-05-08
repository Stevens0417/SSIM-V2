"use client";

import { useState, useMemo, useCallback } from "react";
import type { StagedDeliveryRow } from "@/services/staged-delivery.service";
import type { CustomerOption } from "@/services/customer.service";
import type {
  StagedDeliveryPrintItem,
  StagedDeliveryPrintCustomer,
} from "@/components/print/StagedDeliveryPrintView";
import { fmtPackageType } from "@/lib/fmt";
import styles from "./StagedDeliveriesTable.module.css";

interface Props {
  rows: StagedDeliveryRow[];
  loading: boolean;
  error: string | null;
  customers: CustomerOption[];
  onCancel: (stagedDeliveryId: string) => void;
  onConvert: (stagedDeliveryId: string) => Promise<void>;
}

export default function StagedDeliveriesTable({
  rows,
  loading,
  error,
  customers,
  onCancel,
  onConvert,
}: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);

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

  const handlePrint = (row: StagedDeliveryRow) => {
    // Gather all items for this staged delivery
    const deliveryItems = rows.filter(
      (r) => r.staged_delivery_id === row.staged_delivery_id
    );

    const customer = customers.find((c) => c.id === row.customer_id);
    const printCustomer: StagedDeliveryPrintCustomer = {
      name: customer?.customer_name ?? row.customer_name,
      farmName: customer?.farm_name ?? "",
      tsaNumber: customer?.tsa_number ?? "",
      phone: customer?.phone_number ?? "",
      address: customer?.address ?? "",
      city: customer?.city ?? "",
      province: customer?.province ?? "",
      postalCode: customer?.postal_code ?? "",
    };

    const printItems: StagedDeliveryPrintItem[] = deliveryItems.map((r) => ({
      product: r.product_name,
      treatment: r.treatment_name,
      units: r.units_staged,
    }));

    const printData = {
      deliveryDate: row.staged_date,
      customer: printCustomer,
      items: printItems,
      notes: row.notes ?? "",
    };

    sessionStorage.setItem(
      "ssim-staged-delivery-print-data",
      JSON.stringify(printData)
    );
    window.open("/staged-deliveries/print", "_blank");
  };

  const handleDelete = (row: StagedDeliveryRow) => {
    const itemCount = rows.filter(
      (r) => r.staged_delivery_id === row.staged_delivery_id
    ).length;
    const msg =
      itemCount > 1
        ? `Cancel this staged delivery for ${row.customer_name} (${itemCount} items)?`
        : `Cancel this staged delivery for ${row.customer_name}?`;

    if (window.confirm(msg)) {
      onCancel(row.staged_delivery_id);
    }
  };

  const handleConvert = useCallback(async (row: StagedDeliveryRow) => {
    const deliveryItems = rows.filter(
      (r) => r.staged_delivery_id === row.staged_delivery_id
    );
    const totalUnits = deliveryItems.reduce((sum, r) => sum + r.units_staged, 0);

    const confirmed = window.confirm(
      `Convert ${totalUnits} unit${totalUnits !== 1 ? "s" : ""} for ${row.customer_name} to an actual delivery?\n\nThis will create a delivery record and cannot be undone.`
    );
    if (!confirmed) return;

    setConvertingId(row.staged_delivery_id);
    setConvertError(null);
    try {
      await onConvert(row.staged_delivery_id);
      setConvertingId(null);
    } catch (err) {
      setConvertError(
        err instanceof Error ? err.message : "Failed to convert staged delivery"
      );
      setConvertingId(null);
    }
  }, [rows, onConvert]);

  if (loading) return <div className={styles.status}>Loading staged deliveries…</div>;
  if (error) return <div className={styles.error}>{error}</div>;

  return (
    <div>
      {convertError && (
        <div className={styles.error}>{convertError}</div>
      )}
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
            ? "No staged deliveries in progress."
            : "No matching staged deliveries."}
        </div>
      ) : (
        <div className={styles.wrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Product</th>
                <th>Treatment</th>
                <th className={styles.center}>Size</th>
                <th className={styles.center}>Pkg</th>
                <th className={styles.right}>Units</th>
                <th>Notes</th>
                <th className={styles.center}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.staged_delivery_item_id}>
                  <td className={styles.deliveryId}>
                    {r.staged_delivery_id.slice(0, 8)}
                  </td>
                  <td>{r.staged_date}</td>
                  <td>{r.customer_name}</td>
                  <td>{r.product_name}</td>
                  <td>{r.treatment_name}</td>
                  <td className={styles.center}>{r.seed_size || "—"}</td>
                  <td className={styles.center}>{fmtPackageType(r.package_type)}</td>
                  <td className={styles.mono}>{r.units_staged}</td>
                  <td className={styles.notes}>
                    {r.notes ? (
                      <span title={r.notes}>
                        {r.notes.length > 30
                          ? r.notes.slice(0, 30) + "…"
                          : r.notes}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={styles.center}>
                    <span className={styles.actionGroup}>
                      <button
                        className={styles.convertBtn}
                        onClick={() => handleConvert(r)}
                        title="Convert to actual delivery"
                        disabled={convertingId !== null}
                      >
                        {convertingId === r.staged_delivery_id
                          ? "Converting…"
                          : "Convert"}
                      </button>
                      <button
                        className={styles.printBtn}
                        onClick={() => handlePrint(r)}
                        title="Print staged delivery form"
                      >
                        Print
                      </button>
                      <button
                        className={styles.deleteBtn}
                        onClick={() => handleDelete(r)}
                        title="Cancel this staged delivery"
                        disabled={convertingId !== null}
                      >
                        Cancel
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
