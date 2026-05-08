"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import DeliveryItemsTable, {
  type DeliveryItem,
  type RowErrors,
  createEmptyDeliveryItem,
} from "@/components/deliveries/DeliveryItemsTable";
import StagedDeliveriesTable from "@/components/staged-deliveries/StagedDeliveriesTable";
import CustomerOrderStatusTable from "@/components/deliveries/CustomerOrderStatusTable";
import {
  fetchNewestSeasonYear,
  fetchPricingOptions,
  type PricingOption,
} from "@/services/pricing.service";
import {
  fetchCustomers,
  type CustomerOption,
} from "@/services/customer.service";
import {
  fetchCustomerOrderStatus,
  type CustomerOrderStatusRow,
} from "@/services/delivery.service";
import {
  createStagedDelivery,
  fetchStagedDeliveries,
  cancelStagedDelivery,
  convertStagedDelivery,
  type StagedDeliveryRow,
} from "@/services/staged-delivery.service";
import {
  fetchPackagingProducts,
  fetchNoTreatmentId,
  type PackagingProduct,
} from "@/services/products.service";
import SearchableSelect from "@/components/orders/SearchableSelect";
import type {
  StagedDeliveryPrintItem,
  StagedDeliveryPrintCustomer,
} from "@/components/print/StagedDeliveryPrintView";
import styles from "./staged-deliveries.module.css";

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

export default function StagedDeliveriesPage() {
  const [view, setView] = useState<View>("new");

  // Season + pricing data
  const [seasonYear, setSeasonYear] = useState<number | null>(null);
  const [pricingOptions, setPricingOptions] = useState<PricingOption[]>([]);
  const [packagingProducts, setPackagingProducts] = useState<PackagingProduct[]>([]);
  const [noTreatmentId, setNoTreatmentId] = useState<string | null>(null);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [dataError, setDataError] = useState<string | null>(null);

  // List view state
  const [stagedRows, setStagedRows] = useState<StagedDeliveryRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [listSuccess, setListSuccess] = useState<string | null>(null);

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
            "No seasons found. Add pricing data before recording staged deliveries."
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

  // Load staged deliveries list
  const loadStagedDeliveries = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    setListSuccess(null);
    try {
      const rows = await fetchStagedDeliveries();
      setStagedRows(rows);
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : "Failed to load staged deliveries"
      );
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === "list") {
      loadStagedDeliveries();
    }
  }, [view, loadStagedDeliveries]);

  // Header state
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [stagedDate, setStagedDate] = useState(todayISO);
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

  const loadOrderStatus = useCallback(
    async (customerId: string, season: number) => {
      setOrderStatusLoading(true);
      setOrderStatusError(null);
      try {
        const rows = await fetchCustomerOrderStatus(customerId, season);
        setOrderStatusRows(rows);
      } catch (err) {
        setOrderStatusError(
          err instanceof Error ? err.message : "Failed to load order status"
        );
      } finally {
        setOrderStatusLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!selectedCustomerId || !seasonYear) {
      setOrderStatusRows([]);
      setOrderStatusError(null);
      return;
    }
    loadOrderStatus(selectedCustomerId, seasonYear);
  }, [selectedCustomerId, seasonYear, loadOrderStatus]);

  // Items state
  const [items, setItems] = useState<DeliveryItem[]>([createEmptyDeliveryItem()]);

  // Save state
  const [isSaving, setIsSaving] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [rowErrors, setRowErrors] = useState<RowErrors>({});
  const [printError, setPrintError] = useState<string | null>(null);

  const validLines = items.filter(
    (it) => it.productId && it.treatmentId && it.units > 0
  );
  const canSave =
    !!selectedCustomerId && validLines.length > 0 && !isSaving && !hasSaved;
  const canPrint = !!selectedCustomerId && validLines.length > 0;

  function validateForm(): {
    ok: boolean;
    formErrors: FormErrors;
    rowErrors: RowErrors;
    rowsToSave: DeliveryItem[];
  } {
    const fErrors: FormErrors = {};
    const rErrors: RowErrors = {};
    let ok = true;

    if (!selectedCustomerId) {
      fErrors.customer = true;
      ok = false;
    }

    if (!stagedDate || !/^\d{4}-\d{2}-\d{2}$/.test(stagedDate)) {
      fErrors.date = true;
      ok = false;
    }

    const nonEmptyRows = items.filter((r) => !isRowEmpty(r));

    if (nonEmptyRows.length === 0) {
      fErrors.noRows = true;
      ok = false;
    }

    for (const row of nonEmptyRows) {
      const rowErr: { product?: boolean; treatment?: boolean; units?: boolean } =
        {};
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
      if (Object.keys(rowErr).length > 0) {
        rErrors[row.id] = rowErr;
      }
    }

    return { ok, formErrors: fErrors, rowErrors: rErrors, rowsToSave: nonEmptyRows };
  }

  const handleSave = async () => {
    if (isSaving) return;

    setSaveError(null);
    setSaveSuccess(null);
    setPrintError(null);

    const { ok, formErrors: fErrs, rowErrors: rErrs, rowsToSave } =
      validateForm();
    setFormErrors(fErrs);
    setRowErrors(rErrs);

    if (!ok) return;

    setIsSaving(true);

    try {
      const itemInserts = rowsToSave.map((row) => ({
        product_id: row.productId,
        treatment_id: row.treatmentId,
        seed_size: row.seedSize || null,
        package_type: row.packageType,
        units_staged: row.units,
      }));

      await createStagedDelivery(
        {
          customer_id: selectedCustomerId!,
          season_year: seasonYear!,
          staged_date: stagedDate,
          notes: notes.trim() || null,
        },
        itemInserts
      );

      setSaveSuccess(
        `Staged delivery saved (${rowsToSave.length} item${rowsToSave.length !== 1 ? "s" : ""}).`
      );
      setHasSaved(true);
      setFormErrors({});
      setRowErrors({});
    } catch (err) {
      console.error("Staged delivery save error:", err);
      setSaveError("Could not save staged delivery. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handlePrint = () => {
    setPrintError(null);

    if (!selectedCustomerId || !selectedCustomer) {
      setPrintError("Select a customer before printing.");
      return;
    }

    if (validLines.length === 0) {
      setPrintError(
        "Add at least one item with product, treatment, and units > 0."
      );
      return;
    }

    const printCustomer: StagedDeliveryPrintCustomer = {
      name: selectedCustomer.customer_name,
      farmName: selectedCustomer.farm_name ?? "",
      tsaNumber: selectedCustomer.tsa_number ?? "",
      phone: selectedCustomer.phone_number ?? "",
      address: selectedCustomer.address ?? "",
      city: selectedCustomer.city ?? "",
      province: selectedCustomer.province ?? "",
      postalCode: selectedCustomer.postal_code ?? "",
    };

    const printItems: StagedDeliveryPrintItem[] = validLines.map((row) => ({
      product: row.product,
      treatment: row.treatment,
      units: row.units,
    }));

    const printData = {
      deliveryDate: stagedDate,
      customer: printCustomer,
      items: printItems,
      notes: notes.trim(),
    };

    sessionStorage.setItem(
      "ssim-staged-delivery-print-data",
      JSON.stringify(printData)
    );
    window.open("/staged-deliveries/print", "_blank");
  };

  const handlePrintAll = () => {
    if (stagedRows.length === 0) return;

    // Group rows by staged_delivery_id preserving original order
    const order: string[] = [];
    const groups = new Map<string, StagedDeliveryRow[]>();
    for (const row of stagedRows) {
      if (!groups.has(row.staged_delivery_id)) {
        order.push(row.staged_delivery_id);
        groups.set(row.staged_delivery_id, []);
      }
      groups.get(row.staged_delivery_id)!.push(row);
    }

    const printAll = order.map((id) => {
      const groupRows = groups.get(id)!;
      const first = groupRows[0];
      const customer = customers.find((c) => c.id === first.customer_id);
      return {
        deliveryDate: first.staged_date,
        customer: {
          name: customer?.customer_name ?? first.customer_name,
          farmName: customer?.farm_name ?? "",
          tsaNumber: customer?.tsa_number ?? "",
          phone: customer?.phone_number ?? "",
          address: customer?.address ?? "",
          city: customer?.city ?? "",
          province: customer?.province ?? "",
          postalCode: customer?.postal_code ?? "",
        } satisfies StagedDeliveryPrintCustomer,
        items: groupRows.map((r) => ({
          product: r.product_name,
          treatment: r.treatment_name,
          units: r.units_staged,
        })) satisfies StagedDeliveryPrintItem[],
        notes: first.notes ?? "",
      };
    });

    sessionStorage.setItem(
      "ssim-staged-delivery-print-all-data",
      JSON.stringify(printAll)
    );
    window.open("/staged-deliveries/print-all", "_blank");
  };

  const clearForm = () => {
    setSelectedCustomerId(null);
    setStagedDate(todayISO());
    setNotes("");
    setItems([createEmptyDeliveryItem()]);
    setSaveError(null);
    setSaveSuccess(null);
    setHasSaved(false);
    setFormErrors({});
    setRowErrors({});
    setPrintError(null);
  };

  const handleCustomerChange = (id: string) => {
    setSelectedCustomerId(id);
    if (formErrors.customer) {
      setFormErrors((prev) => ({ ...prev, customer: false }));
    }
    setSaveSuccess(null);
    setPrintError(null);
  };

  const handleDateChange = (date: string) => {
    setStagedDate(date);
    if (formErrors.date) {
      setFormErrors((prev) => ({ ...prev, date: false }));
    }
    setSaveSuccess(null);
  };

  const handleItemsChange = (newItems: DeliveryItem[]) => {
    setItems(newItems);
    if (Object.keys(rowErrors).length > 0) setRowErrors({});
    if (formErrors.noRows) setFormErrors((prev) => ({ ...prev, noRows: false }));
    setSaveSuccess(null);
    setPrintError(null);
  };

  // List view handlers
  const handleCancelStagedDelivery = async (stagedDeliveryId: string) => {
    setListSuccess(null);
    try {
      await cancelStagedDelivery(stagedDeliveryId);
      setStagedRows((prev) =>
        prev.filter((r) => r.staged_delivery_id !== stagedDeliveryId)
      );
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : "Failed to cancel staged delivery"
      );
    }
  };

  const handleConvertStagedDelivery = async (stagedDeliveryId: string) => {
    const result = await convertStagedDelivery(stagedDeliveryId);
    setStagedRows((prev) =>
      prev.filter((r) => r.staged_delivery_id !== stagedDeliveryId)
    );
    setListSuccess(
      `Converted to delivery (${result.deliveryRowsCreated} row${result.deliveryRowsCreated !== 1 ? "s" : ""} created).`
    );
  };

  const hasErrors =
    Object.values(formErrors).some(Boolean) ||
    Object.keys(rowErrors).length > 0;

  return (
    <div>
      {/* ---- View Toggle ---- */}
      <div className={styles.viewToggle}>
        <button
          className={`${styles.toggleBtn} ${view === "new" ? styles.toggleActive : ""}`}
          onClick={() => setView("new")}
        >
          New Staged Delivery
        </button>
        <button
          className={`${styles.toggleBtn} ${view === "list" ? styles.toggleActive : ""}`}
          onClick={() => setView("list")}
        >
          In Progress
        </button>
      </div>

      {dataError && <div className={styles.error}>{dataError}</div>}

      {view === "list" ? (
        <>
          {listSuccess && (
            <div className={styles.success}>{listSuccess}</div>
          )}
          {stagedRows.length > 0 && (
            <div className={styles.listToolbar}>
              <button
                className={styles.printAllBtn}
                onClick={handlePrintAll}
              >
                Print All In Progress
              </button>
            </div>
          )}
          <StagedDeliveriesTable
            rows={stagedRows}
            loading={listLoading}
            error={listError}
            customers={customers}
            onCancel={handleCancelStagedDelivery}
            onConvert={handleConvertStagedDelivery}
          />
        </>
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
              <div className={styles.headerTitle}>Staged Delivery Form</div>
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

          {/* ---- Header Fields ---- */}
          <div className={styles.headerGrid}>
            {/* Customer */}
            <div className={styles.field}>
              <label className={styles.label}>Customer</label>
              <div
                className={`${styles.customerRow} ${formErrors.customer ? styles.fieldError : ""}`}
              >
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

            {/* Staged Date */}
            <div className={styles.field}>
              <label className={styles.label}>Staged Date</label>
              <input
                className={`${styles.input} ${formErrors.date ? styles.inputError : ""}`}
                type="date"
                value={stagedDate}
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
              <span className={styles.readonlyBadge}>{seasonYear ?? "—"}</span>
            </div>
          </div>

          {/* ---- Staged Items ---- */}
          <div className={styles.sectionLabel}>Staged Items</div>
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
            placeholder="Optional notes…"
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

          {/* ---- Desktop Actions ---- */}
          <div className={styles.actions}>
            <button
              className={styles.saveBtn}
              disabled={!canSave}
              onClick={handleSave}
            >
              {isSaving
                ? "Saving…"
                : hasSaved
                ? "Saved ✓"
                : "Save Staged Delivery"}
            </button>
            <button
              className={styles.clearBtn}
              onClick={clearForm}
              disabled={isSaving}
            >
              New Staged Delivery
            </button>
            <button
              className={styles.printBtn}
              disabled={!canPrint}
              onClick={handlePrint}
            >
              Print Staged Delivery
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
              {isSaving ? "Saving…" : hasSaved ? "Saved ✓" : "Save Staged"}
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
