"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import ReplantItemsTable, {
  type ReplantItem,
  type RowErrors,
  createEmptyReplantItem,
} from "@/components/replants/ReplantItemsTable";
import ThisSeasonReplantsTable from "@/components/replants/ThisSeasonReplantsTable";
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
  createReplantEntries,
  fetchReplantsThisSeason,
  updateReplantEntry,
  deleteReplantEntry,
  type ReplantEntryInsert,
  type ReplantViewRow,
} from "@/services/replants.service";
import SearchableSelect from "@/components/orders/SearchableSelect";
import type {
  ReplantPrintItem,
  ReplantPrintCustomer,
} from "@/components/print/ReplantPrintView";
import {
  fetchCustomerOrderStatus,
  type CustomerOrderStatusRow,
} from "@/services/delivery.service";
import CustomerOrderStatusTable from "@/components/deliveries/CustomerOrderStatusTable";
import { findOrderLineMatches } from "@/services/orderMatching.service";
import styles from "./replants.module.css";

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

function isRowEmpty(row: ReplantItem): boolean {
  return !row.productId && !row.treatmentId && row.units === 0;
}

export default function ReplantsPage() {
  const router = useRouter();

  // View toggle
  const [view, setView] = useState<View>("new");

  // Season + pricing data
  const [seasonYear, setSeasonYear] = useState<number | null>(null);
  const [pricingOptions, setPricingOptions] = useState<PricingOption[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [dataError, setDataError] = useState<string | null>(null);

  // List view state
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
            "No seasons found. Add pricing data before recording replants."
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
      setListError(err instanceof Error ? err.message : "Failed to load replants");
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

  const customerSelectOptions = useMemo(
    () => customers.map((c) => ({ value: c.id, label: c.customer_name })),
    [customers]
  );

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId]
  );

  // Items state
  const [items, setItems] = useState<ReplantItem[]>([
    createEmptyReplantItem(),
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
    rowsToSave: ReplantItem[];
  } {
    const fErrors: FormErrors = {};
    const rErrors: RowErrors = {};
    let ok = true;

    if (!selectedCustomerId) {
      fErrors.customer = true;
      ok = false;
    }

    if (!replantDate || !/^\d{4}-\d{2}-\d{2}$/.test(replantDate)) {
      fErrors.date = true;
      ok = false;
    }

    const nonEmptyRows = items.filter((r) => !isRowEmpty(r));

    if (nonEmptyRows.length === 0) {
      fErrors.noRows = true;
      ok = false;
    }

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
    setLinkErrors([]);

    const { ok, formErrors: fErrs, rowErrors: rErrs, rowsToSave } = validateForm();
    setFormErrors(fErrs);
    setRowErrors(rErrs);

    if (!ok) return;

    setIsSaving(true);

    try {
      const linesToMatch = rowsToSave.map((row) => ({
        product_id: row.productId,
        treatment_id: row.treatmentId,
        seed_size: row.seedSize || null,
        package_type: row.packageType,
      }));

      const matches = await findOrderLineMatches(
        selectedCustomerId!,
        seasonYear!,
        linesToMatch
      );

      const ambiguousErrors: string[] = [];
      matches.forEach((match, i) => {
        if (match === "ambiguous") {
          const row = rowsToSave[i];
          ambiguousErrors.push(
            `${row.product} / ${row.treatment}${row.seedSize ? ` (${row.seedSize})` : ""}: multiple matching order lines found — resolve the ambiguity before saving.`
          );
        }
      });

      if (ambiguousErrors.length > 0) {
        setLinkErrors(ambiguousErrors);
        return;
      }

      const payloadRows: ReplantEntryInsert[] = rowsToSave.map((row, i) => {
        const match = matches[i];
        return {
          replant_date: replantDate,
          season_year: seasonYear!,
          customer_id: selectedCustomerId!,
          product_id: row.productId,
          treatment_id: row.treatmentId,
          units_replanted: row.units,
          seed_size: row.seedSize || null,
          package_type: row.packageType,
          order_id: match && match !== "ambiguous" ? match.order_id : null,
          order_item_id: match && match !== "ambiguous" ? match.order_item_id : null,
          notes: notes.trim() || null,
        };
      });

      const result = await createReplantEntries(payloadRows);
      setSaveSuccess(`Saved replant (${result.ids.length} lines).`);
      setHasSaved(true);
      setFormErrors({});
      setRowErrors({});
      if (selectedCustomerId && seasonYear) {
        loadOrderStatus(selectedCustomerId, seasonYear);
      }
    } catch (err) {
      console.error("Replant save error:", err);
      setSaveError("Could not save replant. Please try again.");
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

    const printCustomer: ReplantPrintCustomer = {
      name: selectedCustomer.customer_name,
      farmName: selectedCustomer.farm_name ?? "",
      tsaNumber: selectedCustomer.tsa_number ?? "",
      phone: selectedCustomer.phone_number ?? "",
      address: selectedCustomer.address ?? "",
      city: selectedCustomer.city ?? "",
      province: selectedCustomer.province ?? "",
      postalCode: selectedCustomer.postal_code ?? "",
    };

    const printItems: ReplantPrintItem[] = validLines.map((row) => ({
      product: row.product,
      treatment: row.treatment,
      units: row.units,
    }));

    const printData = {
      replantDate,
      customer: printCustomer,
      items: printItems,
      notes: notes.trim(),
    };

    sessionStorage.setItem("ssim-replant-print-data", JSON.stringify(printData));
    router.push("/replants/print");
  };

  // Clear form
  const clearForm = () => {
    setSelectedCustomerId(null);
    setReplantDate(todayISO());
    setNotes("");
    setItems([createEmptyReplantItem()]);
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
    setReplantDate(date);
    if (formErrors.date) {
      setFormErrors((prev) => ({ ...prev, date: false }));
    }
    setSaveSuccess(null);
  };

  const handleItemsChange = (newItems: ReplantItem[]) => {
    setItems(newItems);
    if (Object.keys(rowErrors).length > 0) setRowErrors({});
    if (formErrors.noRows) setFormErrors((prev) => ({ ...prev, noRows: false }));
    if (linkErrors.length > 0) setLinkErrors([]);
    setSaveSuccess(null);
    setPrintError(null);
  };

  // List view handlers
  const handleDeleteReplant = async (replantId: string) => {
    try {
      await deleteReplantEntry(replantId);
      setReplantRows((prev) => prev.filter((r) => r.replant_id !== replantId));
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to delete replant");
    }
  };

  const handleUpdateReplant = async (
    replantId: string,
    updates: {
      replant_date: string;
      customer_id: string;
      product_id: string;
      treatment_id: string;
      units_replanted: number;
      seed_size: string | null;
      package_type: string;
      notes: string | null;
    }
  ) => {
    try {
      await updateReplantEntry(replantId, updates);
      await loadReplants();
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to update replant");
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
          New Replant
        </button>
        <button
          className={`${styles.toggleBtn} ${view === "list" ? styles.toggleActive : ""}`}
          onClick={() => setView("list")}
        >
          This Season Replants
        </button>
      </div>

      {dataError && <div className={styles.error}>{dataError}</div>}

      {view === "list" ? (
        <ThisSeasonReplantsTable
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
              <div className={styles.headerTitle}>Seed Replant Form</div>
              <div className={styles.headerSub}>
                Stevens Seeds &mdash; {seasonYear ?? "\u2014"}
              </div>
            </div>
          </div>

          {/* Success/Error messages */}
          {saveSuccess && <div className={styles.success}>{saveSuccess}</div>}
          {saveError && <div className={styles.error}>{saveError}</div>}
          {printError && <div className={styles.error}>{printError}</div>}
          {linkErrors.length > 0 && (
            <div className={styles.error}>
              Could not auto-link to order line:
              <ul style={{ margin: "4px 0 0 0", paddingLeft: 20 }}>
                {linkErrors.map((msg, i) => <li key={i}>{msg}</li>)}
              </ul>
            </div>
          )}
          {hasErrors && (
            <div className={styles.error}>Fix the highlighted fields.</div>
          )}

          {/* ---- Replant Header Fields ---- */}
          <div className={styles.headerGrid}>
            {/* Customer */}
            <div className={styles.field}>
              <label className={styles.label}>Customer</label>
              <div className={`${styles.customerRow} ${formErrors.customer ? styles.fieldError : ""}`}>
                <SearchableSelect
                  options={customerSelectOptions}
                  value={selectedCustomerId ?? ""}
                  onChange={handleCustomerChange}
                  placeholder="Search Customer"
                  disabled={isSaving}
                />
                {selectedCustomerId && (
                  <button
                    className={styles.chipRemove}
                    onClick={() => setSelectedCustomerId(null)}
                    disabled={isSaving}
                  >
                    \u00D7
                  </button>
                )}
              </div>
              {formErrors.customer && (
                <span className={styles.fieldErrorText}>Select a customer</span>
              )}
            </div>

            {/* Replant Date */}
            <div className={styles.field}>
              <label className={styles.label}>Replant Date</label>
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
                {seasonYear ?? "\u2014"}
              </span>
            </div>
          </div>

          {/* ---- Replant Items ---- */}
          <div className={styles.sectionLabel}>Replant Items</div>
          {formErrors.noRows && (
            <div className={styles.error} style={{ marginBottom: 8 }}>
              Add at least one item with product, treatment, and units.
            </div>
          )}
          <ReplantItemsTable
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
            placeholder="Optional Replant Notes"
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
              {isSaving ? "Saving\u2026" : hasSaved ? "Saved \u2713" : "Save Replant"}
            </button>
            <button
              className={styles.clearBtn}
              onClick={clearForm}
              disabled={isSaving}
            >
              New Replant
            </button>
            <button
              className={styles.printBtn}
              disabled={!canPrint}
              onClick={handlePrint}
            >
              Print Replant
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
              {isSaving ? "Saving\u2026" : hasSaved ? "Saved \u2713" : "Save Replant"}
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
