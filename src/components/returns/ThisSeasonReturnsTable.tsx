"use client";

import { useState, useMemo } from "react";
import type { PricingOption } from "@/services/pricing.service";
import type { CustomerOption } from "@/services/customer.service";
import type { ReplantViewRow } from "@/services/replant.service";
import type {
  ReturnPrintItem,
  ReturnPrintCustomer,
} from "@/components/print/ReturnPrintView";
import SearchableSelect from "@/components/orders/SearchableSelect";
import { fmtPackageType } from "@/lib/fmt";
import styles from "./ThisSeasonReturnsTable.module.css";

interface Props {
  rows: ReplantViewRow[];
  loading: boolean;
  error: string | null;
  pricingOptions: PricingOption[];
  customers: CustomerOption[];
  onDelete: (returnId: string) => void;
  onUpdate: (
    returnId: string,
    updates: {
      return_date: string;
      customer_id: string;
      product_id: string;
      treatment_id: string;
      units_returned: number;
      seed_size: string | null;
      package_type: string;
      notes: string | null;
    }
  ) => void;
}

export default function ThisSeasonReturnsTable({
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
    return_date: string;
    customer_id: string;
    product_id: string;
    treatment_id: string;
    units_returned: number;
    seed_size: string;
    package_type: string;
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

  const cropByProduct = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of pricingOptions) {
      if (!map.has(o.product_id)) map.set(o.product_id, o.crop.toLowerCase());
    }
    return map;
  }, [pricingOptions]);

  const startEdit = (row: ReplantViewRow) => {
    setEditingId(row.return_id);
    setEditForm({
      return_date: row.return_date,
      customer_id: row.customer_id,
      product_id: row.product_id,
      treatment_id: row.treatment_id,
      units_returned: row.units_returned,
      seed_size: row.seed_size ?? "",
      package_type: row.package_type ?? "bag",
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
    if (!editForm.units_returned || editForm.units_returned <= 0) {
      setEditError("Units must be greater than 0");
      return;
    }
    if (!editForm.return_date) {
      setEditError("Return date is required");
      return;
    }

    onUpdate(editingId, {
      return_date: editForm.return_date,
      customer_id: editForm.customer_id,
      product_id: editForm.product_id,
      treatment_id: editForm.treatment_id,
      units_returned: editForm.units_returned,
      seed_size: cropByProduct.get(editForm.product_id) === "corn" ? (editForm.seed_size || null) : null,
      package_type: editForm.package_type,
      notes: editForm.notes.trim() || null,
    });
    cancelEdit();
  };

  const handleProductChange = (productId: string) => {
    if (!editForm) return;
    const treatments = pricingOptions.filter((o) => o.product_id === productId);
    const treatmentId = treatments.length === 1 ? treatments[0].treatment_id : "";
    const crop = cropByProduct.get(productId) ?? "";
    setEditForm({
      ...editForm,
      product_id: productId,
      treatment_id: treatmentId,
      seed_size: crop === "corn" ? editForm.seed_size : "",
    });
  };

  const handlePrintRow = (row: ReplantViewRow) => {
    const customer = customers.find((c) => c.id === row.customer_id);
    const printCustomer: ReturnPrintCustomer = {
      name: customer?.customer_name ?? row.customer_name,
      farmName: customer?.farm_name ?? "",
      tsaNumber: customer?.tsa_number ?? "",
      phone: customer?.phone_number ?? "",
      address: customer?.address ?? "",
      city: customer?.city ?? "",
      province: customer?.province ?? "",
      postalCode: customer?.postal_code ?? "",
    };
    const printItems: ReturnPrintItem[] = [
      {
        product: row.product_name,
        treatment: row.treatment_name,
        units: row.units_returned,
      },
    ];
    const printData = {
      returnDate: row.return_date,
      customer: printCustomer,
      items: printItems,
      notes: row.notes ?? "",
    };
    sessionStorage.setItem("ssim-return-print-data", JSON.stringify(printData));
    window.open("/returns/print", "_blank");
  };

  if (loading) return <div className={styles.status}>Loading returns…</div>;
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
            ? "No returns found for this season."
            : "No matching returns."}
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
                <tr key={r.return_id}>
                  <td className={styles.replantId}>
                    {r.return_id.slice(0, 8)}
                  </td>
                  <td>{r.return_date}</td>
                  <td>{r.customer_name}</td>
                  <td>{r.product_name}</td>
                  <td>{r.treatment_name}</td>
                  <td className={styles.center}>{r.seed_size || "—"}</td>
                  <td className={styles.center}>{fmtPackageType(r.package_type)}</td>
                  <td className={styles.mono}>{r.units_returned}</td>
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
                        className={styles.printBtn}
                        onClick={() => handlePrintRow(r)}
                      >
                        Print
                      </button>
                      <button
                        className={styles.deleteBtn}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete this return for ${r.customer_name}?`
                            )
                          ) {
                            onDelete(r.return_id);
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
              <h3 className={styles.modalTitle}>Edit Return</h3>
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
                <label className={styles.formLabel}>Return Date</label>
                <input
                  type="date"
                  className={styles.formInput}
                  value={editForm.return_date}
                  onChange={(e) =>
                    setEditForm({ ...editForm, return_date: e.target.value })
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
                <label className={styles.formLabel}>Units Returned</label>
                <input
                  type="number"
                  className={styles.formInput}
                  value={editForm.units_returned || ""}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      units_returned: parseInt(e.target.value) || 0,
                    })
                  }
                  min={1}
                />
              </div>

              {cropByProduct.get(editForm.product_id) === "corn" && (
                <div className={styles.formField}>
                  <label className={styles.formLabel}>Seed Size</label>
                  <select
                    className={styles.formInput}
                    value={editForm.seed_size}
                    onChange={(e) => setEditForm({ ...editForm, seed_size: e.target.value })}
                  >
                    <option value="">—</option>
                    <option value="AR">AR</option>
                    <option value="AR2">AR2</option>
                    <option value="AF">AF</option>
                    <option value="AF2">AF2</option>
                    <option value="P26">P26</option>
                  </select>
                </div>
              )}

              <div className={styles.formField}>
                <label className={styles.formLabel}>Package Type</label>
                <select
                  className={styles.formInput}
                  value={editForm.package_type}
                  onChange={(e) => setEditForm({ ...editForm, package_type: e.target.value })}
                >
                  <option value="bag">Bag</option>
                  <option value="tote">Tote</option>
                </select>
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
              <button
                className={styles.printBtn}
                onClick={() => {
                  const row = rows.find((r) => r.return_id === editingId);
                  if (row) handlePrintRow(row);
                }}
              >
                Print
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
