"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import type {
  ReturnPrintItem,
  ReturnPrintCustomer,
} from "@/components/print/ReturnPrintView";
import ReturnItemsTable, {
  type ReturnItem,
  type RowErrors,
  createEmptyReturnItem,
} from "@/components/returns/ReturnItemsTable";
import ThisSeasonReturnsTable from "@/components/returns/ThisSeasonReturnsTable";
import {
  fetchNewestSeasonYear,
  fetchPricingOptions,
  type PricingOption,
} from "@/services/pricing.service";
import {
  fetchCustomers,
  type CustomerOption,
} from "@/services/customer.service";
import SearchableSelect from "@/components/orders/SearchableSelect";
import {
  createReplants,
  fetchReplantsThisSeason,
  updateReplant,
  deleteReplant,
  type ReplantInsert,
  type ReplantViewRow,
} from "@/services/replant.service";
import styles from "./returns.module.css";

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

function isRowEmpty(row: ReturnItem): boolean {
  return !row.productId && !row.treatmentId && row.units === 0;
}

export default function ReturnsPage() {
  const router = useRouter();

  // View toggle
  const [view, setView] = useState<View>("new");

  // Season + pricing data
  const [seasonYear, setSeasonYear] = useState<number | null>(null);
  const [pricingOptions, setPricingOptions] = useState<PricingOption[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [dataError, setDataError] = useState<string | null>(null);

  // List view state (stubbed - local state only for now)
  const [replantRows, setReplantRows] = useState<ReplantViewRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Load initial data
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [year, custs] = await Promise.all([
          fetchNewestSeasonYear(),
          fetchCustomers(),
        ]);
        if (cancelled) return;
        setCustomers(custs);
        if (year === null) {
          setDataError(
            "No seasons found. Add pricing data before recording returns."
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

  // Load replants list when switching to list view
  const loadReplants = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const rows = await fetchReplantsThisSeason();
      setReplantRows(rows);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to load returns");
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === "list") {
      loadReplants();
    }
  }, [view, loadReplants]);

  // Header state
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null
  );
  const [replantDate, setReplantDate] = useState(todayISO);
  const [notes, setNotes] = useState("");

  const customerSelectOptions = useMemo(
    () => customers.map((c) => ({ value: c.id, label: c.customer_name })),
    [customers]
  );

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId]
  );

  // Items state
  const [items, setItems] = useState<ReturnItem[]>([
    createEmptyReturnItem(),
  ]);

  // Save state
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [rowErrors, setRowErrors] = useState<RowErrors>({});
  const [printError, setPrintError] = useState<string | null>(null);

  // Validation for button enable (simple check)
  const validLines = items.filter(
    (it) => it.productId && it.treatmentId && it.units > 0
  );
  const canSave = !!selectedCustomerId && validLines.length > 0 && !isSaving;
  const canPrint = !!selectedCustomerId && validLines.length > 0;

  // Full validation
  function validateForm(): {
    ok: boolean;
    formErrors: FormErrors;
    rowErrors: RowErrors;
    rowsToSave: ReturnItem[];
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
    if (!replantDate || !/^\d{4}-\d{2}-\d{2}$/.test(replantDate)) {
      fErrors.date = true;
      ok = false;
    }

    // Filter out completely empty rows
    const nonEmptyRows = items.filter((r) => !isRowEmpty(r));

    if (nonEmptyRows.length === 0) {
      fErrors.noRows = true;
      ok = false;
    }

    // Validate each non-empty row
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

  // Save handler
  const handleSave = async () => {
    if (isSaving) return;

    setSaveError(null);
    setSaveSuccess(null);
    setPrintError(null);

    const { ok, formErrors: fErrs, rowErrors: rErrs, rowsToSave } = validateForm();
    setFormErrors(fErrs);
    setRowErrors(rErrs);

    if (!ok) {
      return;
    }

    setIsSaving(true);

    const payloadRows: ReplantInsert[] = rowsToSave.map((row) => ({
      return_date: replantDate,
      season_year: seasonYear!,
      customer_id: selectedCustomerId!,
      product_id: row.productId,
      treatment_id: row.treatmentId,
      units_returned: row.units,
      seed_size: row.seedSize || null,
      order_id: null,
      order_item_id: null,
      notes: notes.trim() || null,
    }));

    try {
      const result = await createReplants(payloadRows);
      setSaveSuccess(`Saved return (${result.ids.length} lines).`);
      // Reset form but keep customer and date
      setItems([createEmptyReturnItem()]);
      setNotes("");
      setFormErrors({});
      setRowErrors({});
    } catch (err) {
      console.error("Return save error:", err);
      setSaveError("Could not save return. Please try again.");
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

    // Build print customer data
    const printCustomer: ReturnPrintCustomer = {
      name: selectedCustomer.customer_name,
      farmName: selectedCustomer.farm_name ?? "",
      tsaNumber: selectedCustomer.tsa_number ?? "",
      phone: selectedCustomer.phone_number ?? "",
      address: selectedCustomer.address ?? "",
      city: selectedCustomer.city ?? "",
      province: selectedCustomer.province ?? "",
      postalCode: selectedCustomer.postal_code ?? "",
    };

    // Build print items from valid lines
    const printItems: ReturnPrintItem[] = validLines.map((row) => {
      const opt = pricingOptions.find(
        (o) => o.product_id === row.productId && o.treatment_id === row.treatmentId
      );
      return {
        product: opt?.product_name ?? row.productId,
        treatment: opt?.treatment_name ?? row.treatmentId,
        units: row.units,
      };
    });

    // Store in sessionStorage and navigate
    const printData = {
      returnDate: replantDate,
      customer: printCustomer,
      items: printItems,
      notes,
    };
    sessionStorage.setItem("ssim-return-print-data", JSON.stringify(printData));
    router.push("/returns/print");
  };

  // Clear form completely (including customer)
  const clearForm = () => {
    setSelectedCustomerId(null);
    setReplantDate(todayISO());
    setNotes("");
    setItems([createEmptyReturnItem()]);
    setSaveError(null);
    setSaveSuccess(null);
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
    setReplantDate(date);
    if (formErrors.date) {
      setFormErrors((prev) => ({ ...prev, date: false }));
    }
    setSaveSuccess(null);
  };

  const handleItemsChange = (newItems: ReturnItem[]) => {
    setItems(newItems);
    // Clear row errors for changed items
    if (Object.keys(rowErrors).length > 0) {
      setRowErrors({});
    }
    if (formErrors.noRows) {
      setFormErrors((prev) => ({ ...prev, noRows: false }));
    }
    setSaveSuccess(null);
    setPrintError(null);
  };

  // List view handlers
  const handleDeleteReplant = async (returnId: string) => {
    try {
      await deleteReplant(returnId);
      setReplantRows((prev) => prev.filter((r) => r.return_id !== returnId));
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to delete return");
    }
  };

  const handleUpdateReplant = async (
    returnId: string,
    updates: {
      return_date: string;
      customer_id: string;
      product_id: string;
      treatment_id: string;
      units_returned: number;
      seed_size: string | null;
      notes: string | null;
    }
  ) => {
    try {
      await updateReplant(returnId, updates);
      // Reload the list to get fresh data
      await loadReplants();
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to update return");
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
          New Return
        </button>
        <button
          className={`${styles.toggleBtn} ${view === "list" ? styles.toggleActive : ""}`}
          onClick={() => setView("list")}
        >
          This Season Returns
        </button>
      </div>

      {dataError && <div className={styles.error}>{dataError}</div>}

      {view === "list" ? (
        <ThisSeasonReturnsTable
          rows={replantRows}
          loading={listLoading}
          error={listError}
          pricingOptions={pricingOptions}
          customers={customers}
          onDelete={handleDeleteReplant}
          onUpdate={handleUpdateReplant}
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
              <div className={styles.headerTitle}>Seed Return Form</div>
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

          {/* ---- Return Header Fields ---- */}
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

            {/* Return Date */}
            <div className={styles.field}>
              <label className={styles.label}>Return Date</label>
              <input
                className={`${styles.input} ${formErrors.date ? styles.inputError : ""}`}
                type="date"
                value={replantDate}
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

          {/* ---- Return Items ---- */}
          <div className={styles.sectionLabel}>Return Items</div>
          {formErrors.noRows && (
            <div className={styles.error} style={{ marginBottom: 8 }}>
              Add at least one item with product, treatment, and units.
            </div>
          )}
          <ReturnItemsTable
            items={items}
            onChange={handleItemsChange}
            pricingOptions={pricingOptions}
            rowErrors={rowErrors}
            disabled={isSaving}
          />

          {/* ---- Notes ---- */}
          <div className={styles.sectionLabel}>Notes</div>
          <textarea
            className={styles.textarea}
            rows={2}
            placeholder="Optional return notes…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ width: "100%" }}
            disabled={isSaving}
          />

          {/* ---- Desktop Actions (hidden on mobile) ---- */}
          <div className={styles.actions}>
            <button
              className={styles.saveBtn}
              disabled={!canSave}
              onClick={handleSave}
            >
              {isSaving ? "Saving…" : "Save Return"}
            </button>
            <button
              className={styles.clearBtn}
              onClick={clearForm}
              disabled={isSaving}
            >
              New Return
            </button>
            <button
              className={styles.printBtn}
              disabled={!canPrint}
              onClick={handlePrint}
            >
              Print Return
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
              {isSaving ? "Saving…" : "Save Return"}
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
