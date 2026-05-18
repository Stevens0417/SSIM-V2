"use client";

import { useState, useMemo } from "react";
import type { DeliveryViewRow, GroupEditPayload, DeliveryInsert } from "@/services/delivery.service";
import { fetchDeliveryGroup } from "@/services/delivery.service";
import type { PricingOption } from "@/services/pricing.service";
import type { CustomerOption } from "@/services/customer.service";
import SearchableSelect from "@/components/orders/SearchableSelect";
import { fmtPackageType } from "@/lib/fmt";
import { requiresSeedSize } from "@/lib/validation/seed-size";
import styles from "./ThisSeasonDeliveriesTable.module.css";

interface EditableItem {
  deliveryId: string | null; // null = newly added
  productId: string;
  productName: string;
  treatmentId: string;
  treatmentName: string;
  units: number;
  seedSize: string;
  packageType: "bag" | "tote";
}

interface Props {
  rows: DeliveryViewRow[];
  loading: boolean;
  error: string | null;
  pricingOptions: PricingOption[];
  customers: CustomerOption[];
  seasonYear: number | null;
  onDelete: (deliveryId: string) => void;
  onGroupUpdate: (payload: GroupEditPayload) => void;
}

export default function ThisSeasonDeliveriesTable({
  rows,
  loading,
  error,
  pricingOptions,
  customers,
  seasonYear,
  onDelete,
  onGroupUpdate,
}: Props) {
  const [searchTerm, setSearchTerm] = useState("");

  // Group edit state
  const [editGroupKey, setEditGroupKey] = useState<string | null>(null);
  const [editHeaderId, setEditHeaderId] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editSeasonYear, setEditSeasonYear] = useState<number | null>(null);
  const [editHeader, setEditHeader] = useState<{
    customer_id: string;
    delivery_date: string;
    notes: string;
  } | null>(null);
  const [editItems, setEditItems] = useState<EditableItem[]>([]);
  const [originalIds, setOriginalIds] = useState<string[]>([]);
  const [editError, setEditError] = useState<string | null>(null);

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

  const productOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const o of pricingOptions) {
      if (!seen.has(o.product_id)) seen.set(o.product_id, o.product_name);
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ value: id, label: name }));
  }, [pricingOptions]);

  const treatmentsByProduct = useMemo(() => {
    const map = new Map<string, Array<{ value: string; label: string }>>();
    for (const o of pricingOptions) {
      if (!map.has(o.product_id)) map.set(o.product_id, []);
      const arr = map.get(o.product_id)!;
      if (!arr.some((t) => t.value === o.treatment_id)) {
        arr.push({ value: o.treatment_id, label: o.treatment_name });
      }
    }
    return map;
  }, [pricingOptions]);

  const cropByProduct = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of pricingOptions) {
      if (!map.has(o.product_id)) map.set(o.product_id, o.crop.toLowerCase());
    }
    return map;
  }, [pricingOptions]);

  const customerOptions = useMemo(
    () => customers.map((c) => ({ value: c.id, label: c.customer_name })),
    [customers]
  );

  // Print: navigate to the group-aware print route
  const handlePrintRow = (row: DeliveryViewRow) => {
    window.open(`/deliveries/print/${row.delivery_id}`, "_blank");
  };

  // Edit: fetch all sibling rows in the same save batch
  const startGroupEdit = async (row: DeliveryViewRow) => {
    setEditGroupKey(row.delivery_id);
    setEditLoading(true);
    setEditError(null);
    try {
      const group = await fetchDeliveryGroup(row.delivery_id);
      if (!group) {
        setEditError("Could not load delivery group.");
        setEditLoading(false);
        return;
      }
      setEditHeaderId(group.header_id);
      setEditSeasonYear(group.season_year);
      setEditHeader({
        customer_id: group.customer_id,
        delivery_date: group.delivery_date,
        notes: group.notes ?? "",
      });
      const items: EditableItem[] = group.items.map((it) => ({
        deliveryId: it.delivery_id,
        productId: it.product_id,
        productName: it.product_name,
        treatmentId: it.treatment_id,
        treatmentName: it.treatment_name,
        units: it.units_delivered,
        seedSize: it.seed_size ?? "",
        packageType: (it.package_type ?? "bag") as "bag" | "tote",
      }));
      setEditItems(items);
      setOriginalIds(items.map((it) => it.deliveryId!));
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to load delivery group.");
    } finally {
      setEditLoading(false);
    }
  };

  const cancelEdit = () => {
    setEditGroupKey(null);
    setEditHeaderId(null);
    setEditLoading(false);
    setEditSeasonYear(null);
    setEditHeader(null);
    setEditItems([]);
    setOriginalIds([]);
    setEditError(null);
  };

  const handleEditItemProduct = (index: number, productId: string) => {
    const opt = pricingOptions.find((o) => o.product_id === productId);
    const productName = opt?.product_name ?? "";
    const treatments = treatmentsByProduct.get(productId) ?? [];
    const treatmentId = treatments.length === 1 ? treatments[0].value : "";
    const treatmentName = treatments.length === 1 ? treatments[0].label : "";
    const crop = cropByProduct.get(productId) ?? "";
    setEditItems((prev) =>
      prev.map((it, i) =>
        i === index
          ? {
              ...it,
              productId,
              productName,
              treatmentId,
              treatmentName,
              seedSize: crop === "corn" ? it.seedSize : "",
            }
          : it
      )
    );
  };

  const handleEditItemTreatment = (index: number, treatmentId: string) => {
    setEditItems((prev) => {
      const item = prev[index];
      const opt = pricingOptions.find(
        (o) => o.product_id === item.productId && o.treatment_id === treatmentId
      );
      return prev.map((it, i) =>
        i === index ? { ...it, treatmentId, treatmentName: opt?.treatment_name ?? "" } : it
      );
    });
  };

  const updateEditItem = (index: number, patch: Partial<EditableItem>) => {
    setEditItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const removeEditItem = (index: number) => {
    setEditItems((prev) => prev.filter((_, i) => i !== index));
  };

  const addEditItem = () => {
    setEditItems((prev) => [
      ...prev,
      {
        deliveryId: null,
        productId: "",
        productName: "",
        treatmentId: "",
        treatmentName: "",
        units: 0,
        seedSize: "",
        packageType: "bag",
      },
    ]);
  };

  const saveGroupEdit = () => {
    if (!editGroupKey || !editHeader) return;

    if (!editHeader.customer_id) {
      setEditError("Customer is required");
      return;
    }
    if (!editHeader.delivery_date) {
      setEditError("Delivery date is required");
      return;
    }
    if (editItems.length === 0) {
      setEditError("At least one item is required");
      return;
    }

    for (let i = 0; i < editItems.length; i++) {
      const item = editItems[i];
      if (!item.productId) {
        setEditError(`Item ${i + 1}: select a product`);
        return;
      }
      if (!item.treatmentId) {
        setEditError(`Item ${i + 1}: select a treatment`);
        return;
      }
      if (!item.units || item.units <= 0) {
        setEditError(`Item ${i + 1}: units must be greater than 0`);
        return;
      }
      if (
        requiresSeedSize(cropByProduct.get(item.productId)) &&
        !item.seedSize?.trim()
      ) {
        setEditError(`Item ${i + 1}: seed size required for corn`);
        return;
      }
    }

    const sharedNotes = editHeader.notes.trim() || null;

    const currentIds = new Set(
      editItems.filter((it) => it.deliveryId !== null).map((it) => it.deliveryId!)
    );
    const deletes = originalIds.filter((id) => !currentIds.has(id));

    const updates: GroupEditPayload["updates"] = editItems
      .filter((it) => it.deliveryId !== null)
      .map((it) => ({
        id: it.deliveryId!,
        data: {
          delivery_date: editHeader.delivery_date,
          customer_id: editHeader.customer_id,
          product_id: it.productId,
          treatment_id: it.treatmentId,
          units_delivered: it.units,
          seed_size:
            cropByProduct.get(it.productId) === "corn"
              ? it.seedSize.trim() || null
              : null,
          package_type: it.packageType,
          notes: sharedNotes,
        },
      }));

    const inserts: DeliveryInsert[] = editItems
      .filter((it) => it.deliveryId === null)
      .map((it) => ({
        delivery_date: editHeader.delivery_date,
        season_year: editSeasonYear ?? seasonYear ?? 0,
        customer_id: editHeader.customer_id,
        product_id: it.productId,
        treatment_id: it.treatmentId,
        units_delivered: it.units,
        seed_size:
          cropByProduct.get(it.productId) === "corn"
            ? it.seedSize.trim() || null
            : null,
        package_type: it.packageType,
        notes: sharedNotes,
        order_id: null,
        order_item_id: null,
      }));

    onGroupUpdate({ header_id: editHeaderId, updates, deletes, inserts });
    cancelEdit();
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
          <button className={styles.clearSearchBtn} onClick={() => setSearchTerm("")}>
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
                <th className={styles.center}>Size</th>
                <th className={styles.center}>Pkg</th>
                <th className={styles.right}>Units</th>
                <th>Notes</th>
                <th className={styles.center}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.delivery_id}>
                  <td className={styles.deliveryId}>{r.delivery_id.slice(0, 8)}</td>
                  <td>{r.delivery_date}</td>
                  <td>{r.customer_name}</td>
                  <td>{r.product_name}</td>
                  <td>{r.treatment_name}</td>
                  <td className={styles.center}>{r.seed_size || "—"}</td>
                  <td className={styles.center}>{fmtPackageType(r.package_type)}</td>
                  <td className={styles.mono}>{r.units_delivered}</td>
                  <td className={styles.notes}>
                    {r.notes ? (
                      <span title={r.notes}>
                        {r.notes.length > 30 ? r.notes.slice(0, 30) + "…" : r.notes}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={styles.center}>
                    <span className={styles.actionGroup}>
                      <button
                        className={styles.editBtn}
                        onClick={() => startGroupEdit(r)}
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
      {editGroupKey && (
        <div className={styles.modalOverlay} onClick={cancelEdit}>
          <div
            className={`${styles.modal} ${styles.modalWide}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div>
                <h3 className={styles.modalTitle}>Edit Delivery</h3>
                {(editHeaderId ?? editGroupKey) && (
                  <div className={styles.editDeliveryId}>
                    Delivery ID:{" "}
                    {(editHeaderId ?? editGroupKey)?.slice(0, 8)}
                  </div>
                )}
              </div>
              <button className={styles.modalClose} onClick={cancelEdit}>
                ×
              </button>
            </div>

            {editLoading ? (
              <div className={styles.editLoadingOverlay}>Loading delivery…</div>
            ) : (
              <>
                <div className={styles.modalBody}>
                  {editError && <div className={styles.error}>{editError}</div>}

                  {/* ---- Header fields ---- */}
                  <div className={styles.formField}>
                    <label className={styles.formLabel}>Customer</label>
                    <SearchableSelect
                      options={customerOptions}
                      value={editHeader?.customer_id ?? ""}
                      onChange={(v) =>
                        setEditHeader((h) => h ? { ...h, customer_id: v } : h)
                      }
                      placeholder="Select customer…"
                    />
                  </div>

                  <div className={styles.formField}>
                    <label className={styles.formLabel}>Delivery Date</label>
                    <input
                      type="date"
                      className={styles.formInput}
                      value={editHeader?.delivery_date ?? ""}
                      onChange={(e) =>
                        setEditHeader((h) => h ? { ...h, delivery_date: e.target.value } : h)
                      }
                    />
                  </div>

                  <div className={styles.formField}>
                    <label className={styles.formLabel}>Notes</label>
                    <textarea
                      className={styles.formTextarea}
                      value={editHeader?.notes ?? ""}
                      onChange={(e) =>
                        setEditHeader((h) => h ? { ...h, notes: e.target.value } : h)
                      }
                      rows={2}
                      placeholder="Optional notes…"
                    />
                  </div>

                  {/* ---- Item rows ---- */}
                  <div className={styles.sectionDivider}>Items</div>

                  {editItems.map((item, i) => {
                    const treatOpts = treatmentsByProduct.get(item.productId) ?? [];
                    const isCorn = cropByProduct.get(item.productId) === "corn";
                    return (
                      <div key={i} className={styles.editItemCard}>
                        <div className={styles.editItemCardHeader}>
                          <span className={styles.editItemNum}>Item {i + 1}</span>
                          <button
                            className={styles.editItemRemove}
                            onClick={() => removeEditItem(i)}
                            title="Remove item"
                          >
                            ×
                          </button>
                        </div>

                        <div className={styles.formField} style={{ marginBottom: 8 }}>
                          <label className={styles.formLabel}>Product</label>
                          <SearchableSelect
                            options={productOptions}
                            value={item.productId}
                            onChange={(v) => handleEditItemProduct(i, v)}
                            placeholder="Select product…"
                          />
                        </div>

                        <div className={styles.formField} style={{ marginBottom: 8 }}>
                          <label className={styles.formLabel}>Treatment</label>
                          <SearchableSelect
                            options={treatOpts}
                            value={item.treatmentId}
                            onChange={(v) => handleEditItemTreatment(i, v)}
                            placeholder="Select treatment…"
                            disabled={!item.productId}
                          />
                        </div>

                        <div className={styles.editItemRow2}>
                          <div className={styles.editItemFieldCompact}>
                            <label>Units</label>
                            <input
                              className={styles.editItemInput}
                              type="number"
                              min={1}
                              value={item.units || ""}
                              onChange={(e) =>
                                updateEditItem(i, { units: parseInt(e.target.value) || 0 })
                              }
                            />
                          </div>
                          {isCorn && (
                            <div className={styles.editItemFieldCompact}>
                              <label>Size</label>
                              <select
                                className={styles.editItemSelect}
                                value={item.seedSize}
                                onChange={(e) =>
                                  updateEditItem(i, { seedSize: e.target.value })
                                }
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
                          <div className={styles.editItemFieldCompact}>
                            <label>Pkg</label>
                            <select
                              className={styles.editItemSelect}
                              value={item.packageType}
                              onChange={(e) =>
                                updateEditItem(i, {
                                  packageType: e.target.value as "bag" | "tote",
                                })
                              }
                            >
                              <option value="bag">Bag</option>
                              <option value="tote">Seedpak</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  <button className={styles.addItemBtn} onClick={addEditItem}>
                    + Add Item
                  </button>
                </div>

                <div className={styles.modalFooter}>
                  <button className={styles.cancelBtn} onClick={cancelEdit}>
                    Cancel
                  </button>
                  <button
                    className={styles.printBtn}
                    onClick={() =>
                      window.open(`/deliveries/print/${editGroupKey}`, "_blank")
                    }
                  >
                    Print
                  </button>
                  <button className={styles.saveBtn} onClick={saveGroupEdit}>
                    Save Changes
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
