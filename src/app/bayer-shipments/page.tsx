"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import ShipmentItemsTable, {
  type ShipmentItem,
  type RowErrors,
  createEmptyShipmentItem,
} from "@/components/bayer-shipments/ShipmentItemsTable";
import ThisSeasonShipmentsTable from "@/components/bayer-shipments/ThisSeasonShipmentsTable";
import YearEndTable from "@/components/bayer-shipments/YearEndTable";
import {
  fetchSeasons,
  fetchPricingOptions,
  type PricingOption,
} from "@/services/pricing.service";
import {
  createBayerShipment,
  updateBayerShipment,
  fetchShipmentSeasons,
  fetchBayerShipments,
  deleteBayerShipment,
  verifyShipmentItem,
  fetchNoTreatmentId,
  fetchPackagingProducts,
  fetchYearEndTotals,
  upsertYearEndVerification,
  type ShipmentViewRow,
  type PackagingProduct,
  type YearEndTotalRow,
} from "@/services/bayer-shipment.service";
import styles from "./bayer-shipments.module.css";

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

type View = "new" | "list" | "yearEnd";

interface FormErrors {
  date?: boolean;
  shipmentNumber?: boolean;
  noRows?: boolean;
}

function isRowEmpty(row: ShipmentItem): boolean {
  return !row.productId && !row.treatmentId && row.units === 0;
}

export default function BayerShipmentsPage() {
  // View toggle
  const [view, setView] = useState<View>("new");

  // Season + pricing data
  const [formSeasons, setFormSeasons] = useState<number[]>([]);
  const [seasonYear, setSeasonYear] = useState<number | null>(null);
  const [pricingOptions, setPricingOptions] = useState<PricingOption[]>([]);
  const [noTreatmentId, setNoTreatmentId] = useState<string | null>(null);
  const [packagingProducts, setPackagingProducts] = useState<PackagingProduct[]>([]);
  const [dataError, setDataError] = useState<string | null>(null);

  // List view state
  const [seasons, setSeasons] = useState<number[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [shipmentRows, setShipmentRows] = useState<ShipmentViewRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Year-end tab state
  const [yearEndRows, setYearEndRows] = useState<YearEndTotalRow[]>([]);
  const [yearEndSeasons, setYearEndSeasons] = useState<number[]>([]);
  const [yearEndSelectedSeason, setYearEndSelectedSeason] = useState<number | null>(null);
  const [yearEndLoading, setYearEndLoading] = useState(false);
  const [yearEndError, setYearEndError] = useState<string | null>(null);

  // Editing state
  const [editingShipmentId, setEditingShipmentId] = useState<string | null>(null);

  // Delete confirmation modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Load pricing options + NO_TREATMENT id + packaging products for the selected season
  const loadSeasonData = useCallback(async (year: number) => {
    setDataError(null);
    try {
      const [opts, ntId, pkgProducts] = await Promise.all([
        fetchPricingOptions(year),
        fetchNoTreatmentId(),
        fetchPackagingProducts(),
      ]);
      if (opts.length === 0) {
        setDataError(`No pricing options found for ${year}.`);
      }
      setPricingOptions(opts);
      setNoTreatmentId(ntId);
      setPackagingProducts(pkgProducts);
    } catch (err) {
      setDataError(err instanceof Error ? err.message : "Failed to load data.");
    }
  }, []);

  // Load available seasons on mount, default to newest
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await fetchSeasons();
        if (cancelled) return;
        if (s.length === 0) {
          setDataError(
            "No seasons found. Add pricing data before recording shipments."
          );
          return;
        }
        setFormSeasons(s);
        const defaultYear = s[0]; // newest season (already desc-sorted)
        setSeasonYear(defaultYear);
        await loadSeasonData(defaultYear);
      } catch (err) {
        if (!cancelled) {
          setDataError(
            err instanceof Error ? err.message : "Failed to load data."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSeasonData]);

  // Handle season dropdown change
  const handleFormSeasonChange = (year: number) => {
    setSeasonYear(year);
    // Clear items since product/treatment options will change
    setItems([createEmptyShipmentItem()]);
    setFormErrors({});
    setRowErrors({});
    loadSeasonData(year);
  };

  // Load seasons + shipments when switching to list view
  const loadShipments = useCallback(async (season: number) => {
    setListLoading(true);
    setListError(null);
    try {
      const rows = await fetchBayerShipments(season);
      setShipmentRows(rows);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to load shipments");
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view !== "list") return;
    let cancelled = false;
    (async () => {
      try {
        const s = await fetchShipmentSeasons();
        if (cancelled) return;
        setSeasons(s);
        const season = s.length > 0 ? s[0] : null;
        setSelectedSeason(season);
        if (season !== null) {
          await loadShipments(season);
        }
      } catch (err) {
        if (!cancelled) {
          setListError(err instanceof Error ? err.message : "Failed to load seasons");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [view, loadShipments]);

  const handleSeasonChange = (season: number) => {
    setSelectedSeason(season);
    loadShipments(season);
  };

  // Load year-end data when switching to yearEnd tab
  const loadYearEndTotals = useCallback(async (season: number) => {
    setYearEndLoading(true);
    setYearEndError(null);
    try {
      const rows = await fetchYearEndTotals(season);
      setYearEndRows(rows);
    } catch (err) {
      setYearEndError(err instanceof Error ? err.message : "Failed to load year-end totals");
    } finally {
      setYearEndLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view !== "yearEnd") return;
    let cancelled = false;
    (async () => {
      try {
        const s = await fetchShipmentSeasons();
        if (cancelled) return;
        setYearEndSeasons(s);
        const season = s.length > 0 ? s[0] : null;
        setYearEndSelectedSeason(season);
        if (season !== null) {
          await loadYearEndTotals(season);
        }
      } catch (err) {
        if (!cancelled) {
          setYearEndError(err instanceof Error ? err.message : "Failed to load seasons");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [view, loadYearEndTotals]);

  const handleYearEndSeasonChange = (season: number) => {
    setYearEndSelectedSeason(season);
    loadYearEndTotals(season);
  };

  // Year-end verify handler — optimistic UI
  const handleYearEndVerify = async (
    productId: string,
    treatmentId: string,
    seedSize: string | null,
    verified: boolean
  ) => {
    const matchRow = (r: YearEndTotalRow) =>
      r.product_id === productId &&
      r.treatment_id === treatmentId &&
      (r.seed_size ?? null) === (seedSize ?? null);

    // Optimistic patch
    setYearEndRows((prev) =>
      prev.map((r) =>
        matchRow(r)
          ? { ...r, is_verified: verified, verified_at: verified ? new Date().toISOString() : null }
          : r
      )
    );

    try {
      await upsertYearEndVerification(
        yearEndSelectedSeason!,
        productId,
        treatmentId,
        seedSize,
        verified
      );
    } catch (err) {
      // Revert on failure
      setYearEndRows((prev) =>
        prev.map((r) =>
          matchRow(r)
            ? { ...r, is_verified: !verified, verified_at: !verified ? new Date().toISOString() : null }
            : r
        )
      );
      throw err;
    }
  };

  // Form state
  const [shipmentDate, setShipmentDate] = useState(todayISO);
  const [shipmentNumber, setShipmentNumber] = useState("");
  const [items, setItems] = useState<ShipmentItem[]>([
    createEmptyShipmentItem(),
  ]);

  // Validation state
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [rowErrors, setRowErrors] = useState<RowErrors>({});

  // Save state
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // Map product_id → crop for corn-aware duplicate detection
  const cropByProduct = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of pricingOptions) {
      if (!map.has(o.product_id)) map.set(o.product_id, o.crop.toLowerCase());
    }
    return map;
  }, [pricingOptions]);

  // Derived total units
  const totalUnits = useMemo(
    () => items.reduce((sum, it) => sum + it.units, 0),
    [items]
  );

  // Validation for button enable
  const validLines = items.filter(
    (it) => it.productId && it.treatmentId && it.units !== 0
  );
  const canSave =
    shipmentNumber.trim().length > 0 && validLines.length > 0 && !isSaving;

  // Full validation
  function validateForm(): {
    ok: boolean;
    formErrors: FormErrors;
    rowErrors: RowErrors;
    rowsToSave: ShipmentItem[];
  } {
    const fErrors: FormErrors = {};
    const rErrors: RowErrors = {};
    let ok = true;

    if (!shipmentDate || !/^\d{4}-\d{2}-\d{2}$/.test(shipmentDate)) {
      fErrors.date = true;
      ok = false;
    }

    if (!shipmentNumber.trim()) {
      fErrors.shipmentNumber = true;
      ok = false;
    }

    // Normalize: non-corn rows must have seedSize cleared
    const nonEmptyRows = items
      .filter((r) => !isRowEmpty(r))
      .map((r) => {
        const isCorn = cropByProduct.get(r.productId) === "corn";
        return isCorn ? r : { ...r, seedSize: "" };
      });

    if (nonEmptyRows.length === 0) {
      fErrors.noRows = true;
      ok = false;
    }

    // Track seen combos for duplicate detection
    // corn: product + treatment + seedSize; non-corn: product + treatment
    const seenLines = new Set<string>();

    for (const row of nonEmptyRows) {
      const rowErr: { product?: boolean; treatment?: boolean; units?: boolean } = {};
      if (!row.productId) {
        rowErr.product = true;
        ok = false;
      }
      if (!row.treatmentId) {
        rowErr.treatment = true;
        ok = false;
      }
      if (!row.units || !Number.isInteger(row.units)) {
        rowErr.units = true;
        ok = false;
      }

      if (row.productId && row.treatmentId) {
        const isCorn = cropByProduct.get(row.productId) === "corn";
        const lineKey = isCorn
          ? `${row.productId}::${row.treatmentId}::${row.seedSize}`
          : `${row.productId}::${row.treatmentId}`;
        if (seenLines.has(lineKey)) {
          rowErr.product = true;
          rowErr.treatment = true;
          ok = false;
        }
        seenLines.add(lineKey);
      }

      if (Object.keys(rowErr).length > 0) {
        rErrors[row.id] = rowErr;
      }
    }

    return { ok, formErrors: fErrors, rowErrors: rErrors, rowsToSave: nonEmptyRows };
  }

  // Save handler
  const handleSave = async () => {
    if (isSaving) return;

    setSaveError(null);
    setSaveSuccess(null);

    const { ok, formErrors: fErrs, rowErrors: rErrs, rowsToSave } = validateForm();
    setFormErrors(fErrs);
    setRowErrors(rErrs);

    if (!ok) return;

    setIsSaving(true);

    try {
      const headerData = {
        shipment_date: shipmentDate,
        shipment_number: shipmentNumber.trim(),
        season_year: seasonYear!,
      };
      const itemData = rowsToSave.map((row) => {
        const isCorn = cropByProduct.get(row.productId) === "corn";
        return {
          product_id: row.productId,
          treatment_id: row.treatmentId,
          units_received: row.units,
          seed_size: isCorn ? (row.seedSize || null) : null,
        };
      });

      let result;
      if (editingShipmentId) {
        result = await updateBayerShipment(editingShipmentId, headerData, itemData);
      } else {
        result = await createBayerShipment(headerData, itemData);
      }

      setSaveSuccess(
        editingShipmentId
          ? `Updated shipment (${result.itemCount} items).`
          : `Saved shipment (${result.itemCount} items).`
      );

      // Refresh list data if a season is selected
      if (selectedSeason !== null) {
        loadShipments(selectedSeason);
      }

      // Reset form
      setShipmentDate(todayISO());
      setShipmentNumber("");
      setItems([createEmptyShipmentItem()]);
      setFormErrors({});
      setRowErrors({});
      setEditingShipmentId(null);
    } catch (err) {
      console.error("Shipment save error:", err);
      setSaveError("Could not save shipment. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  // Clear validation on field changes
  const handleDateChange = (date: string) => {
    setShipmentDate(date);
    if (formErrors.date) {
      setFormErrors((prev) => ({ ...prev, date: false }));
    }
    setSaveSuccess(null);
  };

  const handleShipmentNumberChange = (value: string) => {
    setShipmentNumber(value);
    if (formErrors.shipmentNumber) {
      setFormErrors((prev) => ({ ...prev, shipmentNumber: false }));
    }
    setSaveSuccess(null);
  };

  const handleItemsChange = (newItems: ShipmentItem[]) => {
    setItems(newItems);
    if (Object.keys(rowErrors).length > 0) {
      setRowErrors({});
    }
    if (formErrors.noRows) {
      setFormErrors((prev) => ({ ...prev, noRows: false }));
    }
    setSaveSuccess(null);
  };

  // Clear form
  const clearForm = () => {
    setShipmentDate(todayISO());
    setShipmentNumber("");
    setItems([createEmptyShipmentItem()]);
    setFormErrors({});
    setRowErrors({});
    setSaveError(null);
    setSaveSuccess(null);
    setEditingShipmentId(null);
  };

  // Edit handler — load shipment into form and switch to "new" tab
  const handleEdit = (shipmentId: string) => {
    const shipmentItems = shipmentRows.filter((r) => r.shipment_id === shipmentId);
    if (shipmentItems.length === 0) return;

    const first = shipmentItems[0];
    setShipmentDate(first.shipment_date);
    setShipmentNumber(first.shipment_number);
    setItems(
      shipmentItems.map((r) => ({
        id: crypto.randomUUID(),
        productId: r.product_id,
        treatmentId: r.treatment_id,
        product: r.product_name,
        treatment: r.treatment_name,
        units: r.units_received,
        seedSize: r.seed_size ?? "",
      }))
    );
    setEditingShipmentId(shipmentId);
    setFormErrors({});
    setRowErrors({});
    setSaveError(null);
    setSaveSuccess(null);

    // Set season dropdown to the shipment's stored season_year and load its pricing
    const shipmentSeason = first.season_year;
    if (shipmentSeason !== seasonYear) {
      setSeasonYear(shipmentSeason);
      loadSeasonData(shipmentSeason);
    }

    setView("new");
  };

  // Verify handler — optimistic UI
  const handleVerify = async (shipmentItemId: string, verified: boolean) => {
    // Optimistic patch
    setShipmentRows((prev) =>
      prev.map((r) =>
        r.shipment_item_id === shipmentItemId
          ? { ...r, is_verified: verified }
          : r
      )
    );

    try {
      await verifyShipmentItem(shipmentItemId, verified);
    } catch (err) {
      // Revert on failure
      setShipmentRows((prev) =>
        prev.map((r) =>
          r.shipment_item_id === shipmentItemId
            ? { ...r, is_verified: !verified }
            : r
        )
      );
      throw err; // re-throw so the table component shows its error banner
    }
  };

  // Delete handler
  const handleDelete = async (shipmentId: string) => {
    try {
      await deleteBayerShipment(shipmentId);
      setShipmentRows((prev) => prev.filter((r) => r.shipment_id !== shipmentId));
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to delete shipment");
    }
  };

  return (
    <div>
      {/* ---- View Toggle ---- */}
      <div className={styles.viewToggle}>
        <button
          className={`${styles.toggleBtn} ${view === "new" ? styles.toggleActive : ""}`}
          onClick={() => setView("new")}
        >
          New Shipment
        </button>
        <button
          className={`${styles.toggleBtn} ${view === "list" ? styles.toggleActive : ""}`}
          onClick={() => setView("list")}
        >
          This Season Shipments
        </button>
        <button
          className={`${styles.toggleBtn} ${view === "yearEnd" ? styles.toggleActive : ""}`}
          onClick={() => setView("yearEnd")}
        >
          Year End
        </button>
      </div>

      {dataError && <div className={styles.error}>{dataError}</div>}

      {view === "list" ? (
        <ThisSeasonShipmentsTable
          rows={shipmentRows}
          seasons={seasons}
          selectedSeason={selectedSeason}
          onSeasonChange={handleSeasonChange}
          loading={listLoading}
          error={listError}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onVerify={handleVerify}
        />
      ) : view === "yearEnd" ? (
        <YearEndTable
          rows={yearEndRows}
          seasons={yearEndSeasons}
          selectedSeason={yearEndSelectedSeason}
          onSeasonChange={handleYearEndSeasonChange}
          loading={yearEndLoading}
          error={yearEndError}
          onVerify={handleYearEndVerify}
        />
      ) : (
        <>
          {/* ---- Header Band ---- */}
          <div className={styles.headerBand}>
            <div className={styles.headerText}>
              <div className={styles.headerTitle}>Bayer Shipment Receipt</div>
              <div className={styles.headerSub}>
                Stevens Seeds &mdash; {seasonYear ?? "\u2014"}
              </div>
            </div>
          </div>

          {/* Success/Error messages */}
          {saveSuccess && <div className={styles.success}>{saveSuccess}</div>}
          {saveError && <div className={styles.error}>{saveError}</div>}
          {(Object.values(formErrors).some(Boolean) || Object.keys(rowErrors).length > 0) && (
            <div className={styles.error}>Fix the highlighted fields.</div>
          )}

          {/* ---- Shipment Header Fields ---- */}
          <div className={styles.headerGrid}>
            {/* Shipment Date */}
            <div className={styles.field}>
              <label className={styles.label}>Shipment Date</label>
              <input
                className={`${styles.input} ${formErrors.date ? styles.inputError : ""}`}
                type="date"
                value={shipmentDate}
                onChange={(e) => handleDateChange(e.target.value)}
                disabled={isSaving}
              />
              {formErrors.date && (
                <span className={styles.fieldErrorText}>Enter a valid date</span>
              )}
            </div>

            {/* Shipment Number */}
            <div className={styles.field}>
              <label className={styles.label}>Shipment Number</label>
              <input
                className={`${styles.input} ${formErrors.shipmentNumber ? styles.inputError : ""}`}
                type="text"
                value={shipmentNumber}
                onChange={(e) => handleShipmentNumberChange(e.target.value)}
                placeholder="e.g. SH-2024-001"
                disabled={isSaving}
              />
              {formErrors.shipmentNumber && (
                <span className={styles.fieldErrorText}>Shipment number is required</span>
              )}
            </div>

            {/* Season */}
            <div className={styles.field}>
              <label className={styles.label}>Season</label>
              <select
                className={styles.input}
                value={seasonYear ?? ""}
                onChange={(e) => handleFormSeasonChange(Number(e.target.value))}
                disabled={isSaving || formSeasons.length === 0}
              >
                {formSeasons.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* ---- Shipment Items ---- */}
          <div className={styles.sectionLabel}>Shipment Items</div>
          {formErrors.noRows && (
            <div className={styles.error} style={{ marginBottom: 8 }}>
              Add at least one item with product, treatment, and units.
            </div>
          )}
          <ShipmentItemsTable
            items={items}
            onChange={handleItemsChange}
            pricingOptions={pricingOptions}
            packagingProducts={packagingProducts}
            noTreatmentId={noTreatmentId}
            rowErrors={rowErrors}
            disabled={isSaving}
          />

          {/* ---- Total Units ---- */}
          <div className={styles.totalRow}>
            Total Units Received: <strong>{totalUnits}</strong>
          </div>

          {/* ---- Desktop Actions ---- */}
          <div className={styles.actions}>
            <button
              className={styles.saveBtn}
              disabled={!canSave}
              onClick={handleSave}
            >
              {isSaving
                ? "Saving\u2026"
                : editingShipmentId
                  ? "Update Shipment"
                  : "Save Shipment"}
            </button>
            <button
              className={styles.clearBtn}
              onClick={clearForm}
              disabled={isSaving}
            >
              New Shipment
            </button>
            {editingShipmentId && (
              <button
                className={styles.deleteBtn}
                disabled={isSaving}
                onClick={() => setShowDeleteModal(true)}
              >
                Delete Shipment
              </button>
            )}
          </div>

          {/* Bottom spacer for mobile sticky bar */}
          <div className={styles.stickyBarSpacer} />

          {/* ---- Mobile Sticky Action Bar ---- */}
          <div className={styles.stickyBar}>
            <button
              className={styles.stickySaveBtn}
              disabled={!canSave}
              onClick={handleSave}
            >
              {isSaving
                ? "Saving\u2026"
                : editingShipmentId
                  ? "Update"
                  : "Save Shipment"}
            </button>
            <button
              className={styles.stickyClearBtn}
              onClick={clearForm}
              disabled={isSaving}
            >
              New
            </button>
          </div>

          {/* ---- Delete Confirmation Modal ---- */}
          {showDeleteModal && editingShipmentId && (
            <div className={styles.modalOverlay} onClick={() => !isDeleting && setShowDeleteModal(false)}>
              <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                  <h3 className={styles.modalTitle}>Delete Shipment</h3>
                  <button
                    className={styles.modalClose}
                    onClick={() => !isDeleting && setShowDeleteModal(false)}
                  >
                    ×
                  </button>
                </div>
                <div className={styles.modalBody}>
                  <p className={styles.confirmText}>
                    Delete shipment <strong>{shipmentNumber}</strong>? This will remove all items.
                  </p>
                </div>
                <div className={styles.modalFooter}>
                  <button
                    className={styles.cancelBtn}
                    onClick={() => setShowDeleteModal(false)}
                    disabled={isDeleting}
                  >
                    Cancel
                  </button>
                  <button
                    className={styles.confirmDeleteBtn}
                    disabled={isDeleting}
                    onClick={async () => {
                      setIsDeleting(true);
                      try {
                        await deleteBayerShipment(editingShipmentId);
                        setShowDeleteModal(false);
                        clearForm();
                        setSaveSuccess("Shipment deleted.");
                        if (selectedSeason !== null) {
                          loadShipments(selectedSeason);
                        }
                      } catch {
                        setSaveError("Failed to delete shipment.");
                      } finally {
                        setIsDeleting(false);
                      }
                    }}
                  >
                    {isDeleting ? "Deleting\u2026" : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
