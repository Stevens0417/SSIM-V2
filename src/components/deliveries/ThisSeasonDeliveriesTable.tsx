"use client";

import { useState, useMemo } from "react";
import type { DeliveryViewRow } from "@/services/delivery.service";
import type { PricingOption } from "@/services/pricing.service";
import type { CustomerOption } from "@/services/customer.service";
import SearchableSelect from "@/components/orders/SearchableSelect";
import styles from "./ThisSeasonDeliveriesTable.module.css";

interface Props {
  rows: DeliveryViewRow[];
  loading: boolean;
  error: string | null;
  pricingOptions: PricingOption[];
  customers: CustomerOption[];
  onDelete: (deliveryId: string) => void;
  onUpdate: (
    deliveryId: string,
    updates: {
      delivery_date: string;
      customer_id: string;
      product_id: string;
      treatment_id: string;
      units_delivered: number;
      notes: string | null;
    }
  ) => void;
}

export default function ThisSeasonDeliveriesTable({
  rows,
  loading,
  error,
  pricingOptions,
  customers,
  onDelete,
  onUpdate,
}: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    delivery_date: string;
    customer_id: string;
    product_id: string;
    treatment_id: string;
    units_delivered: number;
    notes: string;
  } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  // Filter rows by search term
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

  // Compute product and treatment options for edit modal
  const productOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const o of pricingOptions) {
      if (!seen.has(o.product_id)) {
        seen.set(o.product_id, o.product_name);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({
      value: id,
      label: name,
    }));
  }, [pricingOptions]);

  const treatmentOptionsForProduct = useMemo(() => {
    if (!editForm?.product_id) return [];
    const treatments: { value: string; label: string }[] = [];
    const seen = new Set<string>();
    for (const o of pricingOptions) {
      if (o.product_id === editForm.product_id && !seen.has(o.treatment_id)) {
        seen.add(o.treatment_id);
        treatments.push({ value: o.treatment_id, label: o.treatment_name });
      }
    }
    return treatments;
  }, [pricingOptions, editForm?.product_id]);

  const customerOptions = useMemo(
    () => customers.map((c) => ({ value: c.id, label: c.customer_name })),
    [customers]
  );

  const startEdit = (row: DeliveryViewRow) => {
    setEditingId(row.delivery_id);
    setEditForm({
      delivery_date: row.delivery_date,
      customer_id: row.customer_id,
      product_id: row.product_id,
      treatment_id: row.treatment_id,
      units_delivered: row.units_delivered,
      notes: row.notes ?? "",
    });
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(null);
    setEditError(null);
  };

  const saveEdit = () => {
    if (!editingId || !editForm) return;

    // Validate
    if (!editForm.customer_id) {
      setEditError("Customer is required");
      return;
    }
    if (!editForm.product_id) {
      setEditError("Product is required");
      return;
    }
    if (!editForm.treatment_id) {
      setEditError("Treatment is required");
      return;
    }
    if (!editForm.units_delivered || editForm.units_delivered <= 0) {
      setEditError("Units must be greater than 0");
      return;
    }
    if (!editForm.delivery_date) {
      setEditError("Delivery date is required");
      return;
    }

    onUpdate(editingId, {
      delivery_date: editForm.delivery_date,
      customer_id: editForm.customer_id,
      product_id: editForm.product_id,
      treatment_id: editForm.treatment_id,
      units_delivered: editForm.units_delivered,
      notes: editForm.notes.trim() || null,
    });
    cancelEdit();
  };

  const handleProductChange = (productId: string) => {
    if (!editForm) return;
    // Reset treatment when product changes
    const treatments = pricingOptions.filter((o) => o.product_id === productId);
    const treatmentId = treatments.length === 1 ? treatments[0].treatment_id : "";
    setEditForm({
      ...editForm,
      product_id: productId,
      treatment_id: treatmentId,
    });
  };

  if (loading) return <div className={styles.status}>Loading deliveries…</div>;
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
            ? "No deliveries found for this season."
            : "No matching deliveries."}
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
                <th className={styles.right}>Units</th>
                <th>Notes</th>
                <th className={styles.center}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.delivery_id}>
                  <td className={styles.deliveryId}>
                    {r.delivery_id.slice(0, 8)}
                  </td>
                  <td>{r.delivery_date}</td>
                  <td>{r.customer_name}</td>
                  <td>{r.product_name}</td>
                  <td>{r.treatment_name}</td>
                  <td className={styles.mono}>{r.units_delivered}</td>
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
                        className={styles.editBtn}
                        onClick={() => startEdit(r)}
                      >
                        Edit
                      </button>
                      <button
                        className={styles.deleteBtn}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete this delivery for ${r.customer_name}?`
                            )
                          ) {
                            onDelete(r.delivery_id);
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

      {/* Edit Modal */}
      {editingId && editForm && (
        <div className={styles.modalOverlay} onClick={cancelEdit}>
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Edit Delivery</h3>
              <button className={styles.modalClose} onClick={cancelEdit}>
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              {editError && <div className={styles.error}>{editError}</div>}

              <div className={styles.formField}>
                <label className={styles.formLabel}>Customer</label>
                <SearchableSelect
                  options={customerOptions}
                  value={editForm.customer_id}
                  onChange={(v) =>
                    setEditForm({ ...editForm, customer_id: v })
                  }
                  placeholder="Select customer…"
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel}>Delivery Date</label>
                <input
                  type="date"
                  className={styles.formInput}
                  value={editForm.delivery_date}
                  onChange={(e) =>
                    setEditForm({ ...editForm, delivery_date: e.target.value })
                  }
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel}>Product</label>
                <SearchableSelect
                  options={productOptions}
                  value={editForm.product_id}
                  onChange={handleProductChange}
                  placeholder="Select product…"
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel}>Treatment</label>
                <SearchableSelect
                  options={treatmentOptionsForProduct}
                  value={editForm.treatment_id}
                  onChange={(v) =>
                    setEditForm({ ...editForm, treatment_id: v })
                  }
                  placeholder="Select treatment…"
                  disabled={!editForm.product_id}
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel}>Units Delivered</label>
                <input
                  type="number"
                  className={styles.formInput}
                  value={editForm.units_delivered || ""}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      units_delivered: parseInt(e.target.value) || 0,
                    })
                  }
                  min={1}
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel}>Notes</label>
                <textarea
                  className={styles.formTextarea}
                  value={editForm.notes}
                  onChange={(e) =>
                    setEditForm({ ...editForm, notes: e.target.value })
                  }
                  rows={2}
                  placeholder="Optional notes…"
                />
              </div>
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.cancelBtn} onClick={cancelEdit}>
                Cancel
              </button>
              <button className={styles.saveBtn} onClick={saveEdit}>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
