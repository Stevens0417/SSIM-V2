"use client";

import { useState, useMemo } from "react";
import type { ShipmentViewRow } from "@/services/bayer-shipment.service";
import styles from "./ThisSeasonShipmentsTable.module.css";

interface Props {
  rows: ShipmentViewRow[];
  seasons: number[];
  selectedSeason: number | null;
  onSeasonChange: (season: number) => void;
  loading: boolean;
  error: string | null;
  onEdit: (shipmentId: string) => void;
  onDelete: (shipmentId: string) => void | Promise<void>;
}

export default function ThisSeasonShipmentsTable({
  rows,
  seasons,
  selectedSeason,
  onSeasonChange,
  loading,
  error,
  onEdit,
  onDelete,
}: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return rows;
    const term = searchTerm.toLowerCase();
    return rows.filter(
      (r) =>
        r.shipment_number.toLowerCase().includes(term) ||
        r.product_name.toLowerCase().includes(term) ||
        r.treatment_name.toLowerCase().includes(term)
    );
  }, [rows, searchTerm]);

  // Group by shipment_id to show delete only once per shipment
  const seenShipments = new Set<string>();

  return (
    <div>
      {/* ---- Season Selector ---- */}
      {seasons.length > 0 && (
        <div className={styles.seasonBar}>
          <label className={styles.seasonLabel}>Season</label>
          <select
            className={styles.seasonSelect}
            value={selectedSeason ?? ""}
            onChange={(e) => onSeasonChange(Number(e.target.value))}
          >
            {seasons.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ---- Search ---- */}
      <div className={styles.searchBar}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Filter by shipment #, product, or treatment…"
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

      {loading ? (
        <div className={styles.status}>Loading shipments…</div>
      ) : error ? (
        <div className={styles.error}>{error}</div>
      ) : filtered.length === 0 ? (
        <div className={styles.status}>
          {rows.length === 0
            ? "No shipments found for this season."
            : "No matching shipments."}
        </div>
      ) : (
        <div className={styles.wrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Shipment Date</th>
                <th>Shipment #</th>
                <th>Product</th>
                <th>Treatment</th>
                <th className={styles.right}>Units Received</th>
                <th className={styles.center}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const isFirstForShipment = !seenShipments.has(r.shipment_id);
                if (isFirstForShipment) seenShipments.add(r.shipment_id);

                return (
                  <tr key={r.shipment_item_id}>
                    <td>{r.shipment_date}</td>
                    <td>{r.shipment_number}</td>
                    <td>{r.product_name}</td>
                    <td>{r.treatment_name}</td>
                    <td className={styles.mono}>{r.units_received}</td>
                    <td className={styles.center}>
                      {isFirstForShipment && (
                        <span className={styles.actionGroup}>
                          <button
                            className={styles.editBtn}
                            onClick={() => onEdit(r.shipment_id)}
                          >
                            Edit
                          </button>
                          <button
                            className={styles.deleteBtn}
                            onClick={() =>
                              setConfirmDelete({ id: r.shipment_id, label: r.shipment_number })
                            }
                          >
                            Delete
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {/* ---- Delete Confirmation Modal ---- */}
      {confirmDelete && (
        <div className={styles.modalOverlay} onClick={() => !deleting && setConfirmDelete(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Delete Shipment</h3>
              <button
                className={styles.modalClose}
                onClick={() => !deleting && setConfirmDelete(null)}
              >
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.confirmText}>
                Delete shipment <strong>{confirmDelete.label}</strong>? This will remove all items.
              </p>
            </div>
            <div className={styles.modalFooter}>
              <button
                className={styles.cancelBtn}
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className={styles.confirmDeleteBtn}
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    await onDelete(confirmDelete.id);
                    setConfirmDelete(null);
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                {deleting ? "Deleting\u2026" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
