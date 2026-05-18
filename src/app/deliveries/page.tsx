"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import DeliveryItemsTable, {
  type DeliveryItem,
  type RowErrors,
  createEmptyDeliveryItem,
} from "@/components/deliveries/DeliveryItemsTable";
import ThisSeasonDeliveriesTable from "@/components/deliveries/ThisSeasonDeliveriesTable";
import CustomerOrderStatusTable from "@/components/deliveries/CustomerOrderStatusTable";
import {
  fetchNewestSeasonYear,
  fetchPricingOptions,
  type PricingOption,
} from "@/services/pricing.service";
import { requiresSeedSize } from "@/lib/validation/seed-size";
import {
  fetchCustomers,
  type CustomerOption,
} from "@/services/customer.service";
import {
  createDeliveryWithHeader,
  fetchDeliveriesThisSeason,
  fetchCustomerOrderStatus,
  applyDeliveryGroupEdits,
  deleteDelivery,
  type DeliveryInsert,
  type DeliveryViewRow,
  type CustomerOrderStatusRow,
  type GroupEditPayload,
} from "@/services/delivery.service";
import { findOrderLineMatches } from "@/services/orderMatching.service";
import {
  fetchPackagingProducts,
  fetchNoTreatmentId,
  type PackagingProduct,
} from "@/services/products.service";
import SearchableSelect from "@/components/orders/SearchableSelect";
import type {
  DeliveryPrintItem,
  DeliveryPrintCustomer,
} from "@/components/print/DeliveryPrintView";
import styles from "./deliveries.module.css";

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

type View = "new" | "list";

interface FormErrors {
  customer?: boolean;
  date?: boolean;
  noRows?: boolean;
}

function isRowEmpty(row: DeliveryItem): boolean {
  return !row.productId && !row.treatmentId && row.units === 0;
}

export default function DeliveriesPage() {
  // View toggle
  const [view, setView] = useState<View>("new");

  // Season + pricing data
  const [seasonYear, setSeasonYear] = useState<number | null>(null);
  const [pricingOptions, setPricingOptions] = useState<PricingOption[]>([]);
  const [packagingProducts, setPackagingProducts] = useState<PackagingProduct[]>([]);
  const [noTreatmentId, setNoTreatmentId] = useState<string | null>(null);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [dataError, setDataError] = useState<string | null>(null);

  // List view state
  const [deliveryRows, setDeliveryRows] = useState<DeliveryViewRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Load initial data
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [year, custs, pkgProducts, noTrtId] = await Promise.all([
          fetchNewestSeasonYear(),
          fetchCustomers(),
          fetchPackagingProducts(),
          fetchNoTreatmentId(),
        ]);
        if (cancelled) return;
        setCustomers(custs);
        setPackagingProducts(pkgProducts);
        setNoTreatmentId(noTrtId);
        if (year === null) {
          setDataError(
            "No seasons found. Add pricing data before recording deliveries."
          );
          return;
        }
        setSeasonYear(year);
        const opts = await fetchPricingOptions(year);
        if (cancelled) return;
        if (opts.length === 0) {
          setDataError(`No pricing options found for ${year}.`);
        }
        setPricingOptions(opts);
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
  }, []);

  // Load deliveries list when switching to list view
  const loadDeliveries = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const rows = await fetchDeliveriesThisSeason();
      setDeliveryRows(rows);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to load deliveries");
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === "list") {
      loadDeliveries();
    }
  }, [view, loadDeliveries]);

  // Header state
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null
  );
  const [deliveryDate, setDeliveryDate] = useState(todayISO);
  const [notes, setNotes] = useState("");

  const customerSelectOptions = useMemo(
    () => customers.map((c) => ({ value: c.id, label: c.customer_name })),
    [customers]
  );

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId]
  );

  // Customer order status
  const [orderStatusRows, setOrderStatusRows] = useState<CustomerOrderStatusRow[]>([]);
  const [orderStatusLoading, setOrderStatusLoading] = useState(false);
  const [orderStatusError, setOrderStatusError] = useState<string | null>(null);

  const loadOrderStatus = useCallback(async (customerId: string, season: number) => {
    setOrderStatusLoading(true);
    setOrderStatusError(null);
    try {
      const rows = await fetchCustomerOrderStatus(customerId, season);
      setOrderStatusRows(rows);
    } catch (err) {
      setOrderStatusError(err instanceof Error ? err.message : "Failed to load order status");
    } finally {
      setOrderStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedCustomerId || !seasonYear) {
      setOrderStatusRows([]);
      setOrderStatusError(null);
      return;
    }
    loadOrderStatus(selectedCustomerId, seasonYear);
  }, [selectedCustomerId, seasonYear, loadOrderStatus]);

  // Items state
  const [items, setItems] = useState<DeliveryItem[]>([
    createEmptyDeliveryItem(),
  ]);

  // Save state
  const [isSaving, setIsSaving] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [rowErrors, setRowErrors] = useState<RowErrors>({});
  const [linkErrors, setLinkErrors] = useState<string[]>([]);
  const [printError, setPrintError] = useState<string | null>(null);

  // Validation for button enable (simple check)
  const validLines = items.filter(
    (it) => it.productId && it.treatmentId && it.units > 0
  );
  const canSave = !!selectedCustomerId && validLines.length > 0 && !isSaving && !hasSaved;
  const canPrint = !!selectedCustomerId && validLines.length > 0;

  // Full validation
  function validateForm(): {
    ok: boolean;
    formErrors: FormErrors;
    rowErrors: RowErrors;
    rowsToSave: DeliveryItem[];
  } {
    const fErrors: FormErrors = {};
    const rErrors: RowErrors = {};
    let ok = true;

    // Customer required
    if (!selectedCustomerId) {
      fErrors.customer = true;
      ok = false;
    }

    // Date required and valid
    if (!deliveryDate || !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
      fErrors.date = true;
      ok = false;
    }

    // Filter out completely empty rows
    const nonEmptyRows = items.filter((r) => !isRowEmpty(r));

    if (nonEmptyRows.length === 0) {
      fErrors.noRows = true;
      ok = false;
    }

    const cropByProduct = new Map(pricingOptions.map((o) => [o.product_id, o.crop]));

    // Validate each non-empty row
    for (const row of nonEmptyRows) {
      const rowErr: { product?: boolean; treatment?: boolean; units?: boolean; seedSize?: boolean } = {};
      if (!row.productId) {
        rowErr.product = true;
        ok = false;
      }
      if (!row.treatmentId) {
        rowErr.treatment = true;
        ok = false;
      }
      if (!row.units || row.units <= 0 || !Number.isInteger(row.units)) {
        rowErr.units = true;
        ok = false;
      }
      if (requiresSeedSize(cropByProduct.get(row.productId)) && !row.seedSize?.trim()) {
        rowErr.seedSize = true;
        ok = false;
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
    setPrintError(null);
    setLinkErrors([]);

    const { ok, formErrors: fErrs, rowErrors: rErrs, rowsToSave } = validateForm();
    setFormErrors(fErrs);
    setRowErrors(rErrs);

    if (!ok) {
      return;
    }

    setIsSaving(true);

    try {
      // Resolve and auto-allocate order lines for each row
      const linesToMatch = rowsToSave.map((row) => ({
        product_id: row.productId,
        treatment_id: row.treatmentId,
        seed_size: row.seedSize || null,
        package_type: row.packageType,
        units: row.units,
      }));

      const allAllocations = await findOrderLineMatches(
        selectedCustomerId!,
        seasonYear!,
        linesToMatch
      );

      const payloadRows: DeliveryInsert[] = [];

      for (let i = 0; i < rowsToSave.length; i++) {
        const row = rowsToSave[i];
        const allocations = allAllocations[i];
        const base = {
          delivery_date: deliveryDate,
          season_year: seasonYear!,
          customer_id: selectedCustomerId!,
          product_id: row.productId,
          treatment_id: row.treatmentId,
          seed_size: row.seedSize || null,
          package_type: row.packageType,
          notes: notes.trim() || null,
        };

        if (allocations.length === 0) {
          // No matching open order lines — save as unlinked
          payloadRows.push({
            ...base,
            units_delivered: row.units,
            order_id: null,
            order_item_id: null,
          });
        } else {
          let totalAllocated = 0;
          for (const alloc of allocations) {
            payloadRows.push({
              ...base,
              units_delivered: alloc.units,
              order_id: alloc.order_id,
              order_item_id: alloc.order_item_id,
            });
            totalAllocated += alloc.units;
          }
          // Any units beyond open order quantity go as an unlinked row
          const remainder = row.units - totalAllocated;
          if (remainder > 0) {
            payloadRows.push({
              ...base,
              units_delivered: remainder,
              order_id: null,
              order_item_id: null,
            });
          }
        }
      }

      const result = await createDeliveryWithHeader(
        {
          customer_id: selectedCustomerId!,
          delivery_date: deliveryDate,
          season_year: seasonYear!,
          notes: notes.trim() || null,
        },
        payloadRows
      );
      setSaveSuccess(`Saved delivery (${rowsToSave.length} line${rowsToSave.length !== 1 ? "s" : ""}, ${result.ids.length} DB row${result.ids.length !== 1 ? "s" : ""}).`);
      setHasSaved(true);
      setFormErrors({});
      setRowErrors({});
      // Refresh order status immediately
      if (selectedCustomerId && seasonYear) {
        loadOrderStatus(selectedCustomerId, seasonYear);
      }
    } catch (err) {
      console.error("Delivery save error:", err);
      setSaveError("Could not save delivery. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  // Print handler
  const handlePrint = () => {
    setPrintError(null);

    if (!selectedCustomerId || !selectedCustomer) {
      setPrintError("Select a customer before printing.");
      return;
    }

    if (validLines.length === 0) {
      setPrintError("Add at least one item with product, treatment, and units > 0.");
      return;
    }

    const printCustomer: DeliveryPrintCustomer = {
      name: selectedCustomer.customer_name,
      farmName: selectedCustomer.farm_name ?? "",
      tsaNumber: selectedCustomer.tsa_number ?? "",
      phone: selectedCustomer.phone_number ?? "",
      address: selectedCustomer.address ?? "",
      city: selectedCustomer.city ?? "",
      province: selectedCustomer.province ?? "",
      postalCode: selectedCustomer.postal_code ?? "",
    };

    const printItems: DeliveryPrintItem[] = validLines.map((row) => ({
      product: row.product,
      treatment: row.treatment,
      units: row.units,
    }));

    const printData = {
      deliveryDate,
      customer: printCustomer,
      items: printItems,
      notes: notes.trim(),
    };

    sessionStorage.setItem("ssim-delivery-print-data", JSON.stringify(printData));
    window.open("/deliveries/print", "_blank");
  };

  // Clear form completely (including customer)
  const clearForm = () => {
    setSelectedCustomerId(null);
    setDeliveryDate(todayISO());
    setNotes("");
    setItems([createEmptyDeliveryItem()]);
    setSaveError(null);
    setSaveSuccess(null);
    setHasSaved(false);
    setFormErrors({});
    setRowErrors({});
    setPrintError(null);
  };

  // Clear validation errors when user makes changes
  const handleCustomerChange = (id: string) => {
    setSelectedCustomerId(id);
    if (formErrors.customer) {
      setFormErrors((prev) => ({ ...prev, customer: false }));
    }
    setSaveSuccess(null);
    setPrintError(null);
  };

  const handleDateChange = (date: string) => {
    setDeliveryDate(date);
    if (formErrors.date) {
      setFormErrors((prev) => ({ ...prev, date: false }));
    }
    setSaveSuccess(null);
  };

  const handleItemsChange = (newItems: DeliveryItem[]) => {
    setItems(newItems);
    // Clear row errors for changed items
    if (Object.keys(rowErrors).length > 0) {
      setRowErrors({});
    }
    if (formErrors.noRows) {
      setFormErrors((prev) => ({ ...prev, noRows: false }));
    }
    if (linkErrors.length > 0) setLinkErrors([]);
    setSaveSuccess(null);
    setPrintError(null);
  };

  // List view handlers
  const handleDeleteDelivery = async (deliveryId: string) => {
    try {
      await deleteDelivery(deliveryId);
      setDeliveryRows((prev) => prev.filter((r) => r.delivery_id !== deliveryId));
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to delete delivery");
    }
  };

  const handleGroupUpdate = async (payload: GroupEditPayload) => {
    try {
      await applyDeliveryGroupEdits(payload);
      await loadDeliveries();
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to update delivery");
    }
  };

  const hasErrors = Object.values(formErrors).some(Boolean) || Object.keys(rowErrors).length > 0;

  return (
    <div>
      {/* ---- View Toggle ---- */}
      <div className={styles.viewToggle}>
        <button
          className={`${styles.toggleBtn} ${view === "new" ? styles.toggleActive : ""}`}
          onClick={() => setView("new")}
        >
          New Delivery
        </button>
        <button
          className={`${styles.toggleBtn} ${view === "list" ? styles.toggleActive : ""}`}
          onClick={() => setView("list")}
        >
          This Season Deliveries
        </button>
      </div>

      {dataError && <div className={styles.error}>{dataError}</div>}

      {view === "list" ? (
        <ThisSeasonDeliveriesTable
          rows={deliveryRows}
          loading={listLoading}
          error={listError}
          pricingOptions={pricingOptions}
          customers={customers}
          seasonYear={seasonYear}
          onDelete={handleDeleteDelivery}
          onGroupUpdate={handleGroupUpdate}
        />
      ) : (
        <>
          {/* ---- Header Band ---- */}
          <div className={styles.headerBand}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={styles.headerLogo}
              src="/assets/logos/dekalb.png"
              alt="DEKALB"
            />
            <div className={styles.headerText}>
              <div className={styles.headerTitle}>Seed Delivery Form</div>
              <div className={styles.headerSub}>
                Stevens Seeds &mdash; {seasonYear ?? "—"}
              </div>
            </div>
          </div>

          {/* Success/Error messages */}
          {saveSuccess && <div className={styles.success}>{saveSuccess}</div>}
          {saveError && <div className={styles.error}>{saveError}</div>}
          {printError && <div className={styles.error}>{printError}</div>}
          {hasErrors && (
            <div className={styles.error}>Fix the highlighted fields.</div>
          )}

          {/* ---- Delivery Header Fields ---- */}
          <div className={styles.headerGrid}>
            {/* Customer */}
            <div className={styles.field}>
              <label className={styles.label}>Customer</label>
              <div className={`${styles.customerRow} ${formErrors.customer ? styles.fieldError : ""}`}>
                <SearchableSelect
                  options={customerSelectOptions}
                  value={selectedCustomerId ?? ""}
                  onChange={handleCustomerChange}
                  placeholder="Search customers…"
                  disabled={isSaving}
                />
                {selectedCustomerId && (
                  <button
                    className={styles.chipRemove}
                    onClick={() => setSelectedCustomerId(null)}
                    disabled={isSaving}
                  >
                    ×
                  </button>
                )}
              </div>
              {formErrors.customer && (
                <span className={styles.fieldErrorText}>Select a customer</span>
              )}
            </div>

            {/* Delivery Date */}
            <div className={styles.field}>
              <label className={styles.label}>Delivery Date</label>
              <input
                className={`${styles.input} ${formErrors.date ? styles.inputError : ""}`}
                type="date"
                value={deliveryDate}
                onChange={(e) => handleDateChange(e.target.value)}
                disabled={isSaving}
              />
              {formErrors.date && (
                <span className={styles.fieldErrorText}>Enter a valid date</span>
              )}
            </div>

            {/* Season (read-only) */}
            <div className={styles.field}>
              <label className={styles.label}>Season</label>
              <span className={styles.readonlyBadge}>
                {seasonYear ?? "—"}
              </span>
            </div>
          </div>

          {/* ---- Delivery Items ---- */}
          <div className={styles.sectionLabel}>Delivery Items</div>
          {formErrors.noRows && (
            <div className={styles.error} style={{ marginBottom: 8 }}>
              Add at least one item with product, treatment, and units.
            </div>
          )}
          <DeliveryItemsTable
            items={items}
            onChange={handleItemsChange}
            pricingOptions={pricingOptions}
            packagingProducts={packagingProducts}
            noTreatmentId={noTreatmentId}
            rowErrors={rowErrors}
            disabled={isSaving}
          />

          {/* ---- Notes ---- */}
          <div className={styles.sectionLabel}>Notes</div>
          <textarea
            className={styles.textarea}
            rows={2}
            placeholder="Optional delivery notes…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ width: "100%" }}
            disabled={isSaving}
          />

          {/* ---- Customer Order Status ---- */}
          {selectedCustomerId && (
            <CustomerOrderStatusTable
              rows={orderStatusRows}
              loading={orderStatusLoading}
              error={orderStatusError}
            />
          )}

          {/* ---- Desktop Actions (hidden on mobile) ---- */}
          <div className={styles.actions}>
            <button
              className={styles.saveBtn}
              disabled={!canSave}
              onClick={handleSave}
            >
              {isSaving ? "Saving…" : hasSaved ? "Saved ✓" : "Save Delivery"}
            </button>
            <button
              className={styles.clearBtn}
              onClick={clearForm}
              disabled={isSaving}
            >
              New Delivery
            </button>
            <button
              className={styles.printBtn}
              disabled={!canPrint}
              onClick={handlePrint}
            >
              Print Delivery
            </button>
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
              {isSaving ? "Saving…" : hasSaved ? "Saved ✓" : "Save Delivery"}
            </button>
            <button
              className={styles.stickyClearBtn}
              onClick={clearForm}
              disabled={isSaving}
            >
              New
            </button>
            <button
              className={styles.stickyPrintBtn}
              disabled={!canPrint}
              onClick={handlePrint}
            >
              Print
            </button>
          </div>
        </>
      )}
    </div>
  );
}
