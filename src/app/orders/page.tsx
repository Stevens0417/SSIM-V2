"use client";

import { useState, useMemo, useEffect } from "react";
import OrderItemsTable, {
  type OrderItem,
  createEmptyItem,
  recalcAllItems,
} from "@/components/orders/OrderItemsTable";
import CustomerCreatePanel, {
  type CustomerDraft,
} from "@/components/orders/CustomerCreatePanel";
import {
  fetchNewestSeasonYear,
  fetchPricingOptions,
  type PricingOption,
} from "@/services/pricing.service";
import {
  fetchCustomers,
  insertCustomer,
  type CustomerOption,
} from "@/services/customer.service";
import SearchableSelect from "@/components/orders/SearchableSelect";
import {
  saveOrder,
  updateOrder,
  fetchOrderItemsThisSeason,
  fetchOrderWithItems,
  deleteOrder,
  type OrderItemViewRow,
} from "@/services/order.service";
import OrderItemsListTable from "@/components/orders/OrderItemsListTable";
import {
  type PrintItem,
  type PrintCustomer,
} from "@/components/print/OrderPrintView";
import styles from "./orders.module.css";

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

type View = "new" | "list";

export default function OrdersPage() {
  // View toggle
  const [view, setView] = useState<View>("new");

  // Season + pricing data
  const [seasonYear, setSeasonYear] = useState<number | null>(null);
  const [pricingOptions, setPricingOptions] = useState<PricingOption[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [dataError, setDataError] = useState<string | null>(null);

  // Orders list state
  const [ordersList, setOrdersList] = useState<OrderItemViewRow[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  // Edit state
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);

  const loadOrderItems = async () => {
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      const rows = await fetchOrderItemsThisSeason();
      setOrdersList(rows);
    } catch (err) {
      setOrdersError(
        err instanceof Error ? err.message : "Failed to load order items"
      );
    } finally {
      setOrdersLoading(false);
    }
  };

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
            "No seasons found. Add pricing data before creating orders."
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
            err instanceof Error ? err.message : "Failed to load pricing data."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Header state
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null
  );
  const [showCustomerPanel, setShowCustomerPanel] = useState(false);

  const customerSelectOptions = useMemo(
    () =>
      customers.map((c) => ({ value: c.id, label: c.customer_name })),
    [customers]
  );

  const handleCustomerSelect = (id: string) => {
    setSelectedCustomerId(id);
  };
  const [orderDate, setOrderDate] = useState(todayISO);
  const [notes, setNotes] = useState("");

  // Discount state
  const [brandGrowerPct, setBrandGrowerPct] = useState(0);
  const [earlyPayPct, setEarlyPayPct] = useState(0);

  // Items state
  const [items, setItems] = useState<OrderItem[]>([createEmptyItem()]);

  // Recalc wiring: items change from table
  const handleItemsChange = (newItems: OrderItem[]) => {
    setItems(recalcAllItems(newItems, brandGrowerPct, earlyPayPct));
  };

  // Recalc wiring: header discount changes
  const handleBrandGrowerChange = (pct: number) => {
    setBrandGrowerPct(pct);
    setItems((prev) => recalcAllItems(prev, pct, earlyPayPct));
  };

  const handleEarlyPayChange = (pct: number) => {
    setEarlyPayPct(pct);
    setItems((prev) => recalcAllItems(prev, brandGrowerPct, pct));
  };

  // Order totals
  const orderTotals = useMemo(() => {
    const totalUnits = items.reduce((s, it) => s + it.units, 0);
    const subtotalBeforeDiscounts = round2(
      items.reduce((s, it) => s + it.lineSubtotalBeforeDiscounts, 0)
    );
    const brandGrowerDiscountTotal = round2(
      items.reduce((s, it) => s + it.brandGrowerDiscountAmount, 0)
    );
    const toteBulkDiscountTotal = round2(
      items.reduce((s, it) => s + it.toteBulkDiscountAmount, 0)
    );
    const subtotalAfterDiscountsBeforeEarlyPay = round2(
      items.reduce(
        (s, it) => s + it.lineTotalAfterDiscountsBeforeEarlyPay,
        0
      )
    );
    const earlyPayDiscountTotal = round2(
      items.reduce((s, it) => s + it.earlyPayDiscountAmount, 0)
    );
    const totalAfterAllDiscounts = round2(
      items.reduce((s, it) => s + it.lineTotalAfterAllDiscounts, 0)
    );
    const totalProfit = round2(
      items.reduce((s, it) => s + it.totalProfit, 0)
    );
    const avgProfitPerUnit =
      totalUnits > 0 ? round4(totalProfit / totalUnits) : 0;

    return {
      totalUnits,
      subtotalBeforeDiscounts,
      brandGrowerDiscountTotal,
      toteBulkDiscountTotal,
      subtotalAfterDiscountsBeforeEarlyPay,
      earlyPayDiscountTotal,
      totalAfterAllDiscounts,
      totalProfit,
      avgProfitPerUnit,
    };
  }, [items]);

  // Customer panel handlers
  const handleCustomerSave = async (data: CustomerDraft) => {
    const result = await insertCustomer({
      customer_name: data.customer_name,
      phone_number: data.phone_number,
      address: data.address,
      city: data.city,
      province: data.province,
      postal_code: data.postal_code,
      farm_name: data.farm_name || undefined,
      tsa_number: data.tsa_number || undefined,
    });
    // Add to local list and auto-select
    setCustomers((prev) => {
      const updated = [
        ...prev,
        {
          id: result.id,
          customer_name: result.customer_name,
          farm_name: data.farm_name || null,
          phone_number: data.phone_number || null,
          address: data.address || null,
          city: data.city || null,
          province: data.province || null,
          postal_code: data.postal_code || null,
          tsa_number: data.tsa_number || null,
        },
      ];
      updated.sort((a, b) => a.customer_name.localeCompare(b.customer_name));
      return updated;
    });
    setSelectedCustomerId(result.id);
    setShowCustomerPanel(false);
  };

  const clearCustomer = () => {
    setSelectedCustomerId(null);
  };

  // Reset form
  const clearForm = () => {
    setEditingOrderId(null);
    setSelectedCustomerId(null);
    setShowCustomerPanel(false);
    setOrderDate(todayISO());
    setNotes("");
    setBrandGrowerPct(0);
    setEarlyPayPct(0);
    setItems([createEmptyItem()]);
    setSaveError(null);
    setSaveSuccess(false);
  };

  // Load order for editing
  const handleEditOrder = async (orderId: string) => {
    try {
      const order = await fetchOrderWithItems(orderId);
      setEditingOrderId(orderId);
      setSelectedCustomerId(order.customer_id);
      setOrderDate(order.order_date);
      setNotes(order.notes ?? "");
      const bgPct = order.brand_grower_pct;
      const epPct = order.early_pay_pct;
      setBrandGrowerPct(bgPct);
      setEarlyPayPct(epPct);

      // Map DB items back to OrderItem[]
      const loadedItems: OrderItem[] = order.items.map((dbItem) => {
        const opt = pricingOptions.find(
          (o) =>
            o.product_id === dbItem.product_id &&
            o.treatment_id === dbItem.treatment_id
        );
        return {
          id: crypto.randomUUID(),
          productId: dbItem.product_id,
          treatmentId: dbItem.treatment_id,
          product: opt?.product_name ?? "",
          treatment: opt?.treatment_name ?? "",
          packageType: dbItem.package_type as "bag" | "tote",
          seedSize: dbItem.seed_size ?? "",
          units: dbItem.units,
          toteBulkDiscountPerUnit: dbItem.tote_bulk_discount_per_unit,
          retailPricePerUnit: dbItem.retail_price_per_unit,
          breakEvenPricePerUnit: dbItem.break_even_price_per_unit,
          // Computed fields — recalc will fill these
          lineSubtotalBeforeDiscounts: 0,
          brandGrowerDiscountAmount: 0,
          toteBulkDiscountAmount: 0,
          lineTotalAfterDiscountsBeforeEarlyPay: 0,
          earlyPayDiscountAmount: 0,
          lineTotalAfterAllDiscounts: 0,
          netPricePerUnit: 0,
          profitPerUnit: 0,
          totalProfit: 0,
        };
      });
      setItems(recalcAllItems(loadedItems, bgPct, epPct));
      setView("new");
      setSaveError(null);
      setSaveSuccess(false);
    } catch (err) {
      setOrdersError(
        err instanceof Error ? err.message : "Failed to load order for editing"
      );
    }
  };

  // Switch to list view
  const handleShowList = () => {
    loadOrderItems();
    setView("list");
  };

  // Delete order
  const handleDeleteOrder = async (orderId: string) => {
    try {
      await deleteOrder(orderId);
      // Refresh list
      await loadOrderItems();
    } catch (err) {
      setOrdersError(
        err instanceof Error ? err.message : "Failed to delete order"
      );
    }
  };

  // Save order
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const validLines = items.filter(
    (it) => it.productId && it.treatmentId && it.units > 0
  );
  const canSave =
    !!selectedCustomerId && !!orderDate && validLines.length > 0 && !saving;

  const handleSaveOrder = async () => {
    if (!canSave || !selectedCustomerId) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    const orderPayload = {
      order_date: orderDate,
      customer_id: selectedCustomerId,
      season_year: seasonYear!,
      brand_grower_pct: brandGrowerPct,
      early_pay_pct: earlyPayPct,
      subtotal_before_discounts: orderTotals.subtotalBeforeDiscounts,
      brand_grower_discount_total: orderTotals.brandGrowerDiscountTotal,
      tote_bulk_discount_total: orderTotals.toteBulkDiscountTotal,
      subtotal_after_discounts_before_early_pay:
        orderTotals.subtotalAfterDiscountsBeforeEarlyPay,
      early_pay_discount_total: orderTotals.earlyPayDiscountTotal,
      total_after_all_discounts: orderTotals.totalAfterAllDiscounts,
      total_profit: orderTotals.totalProfit,
      avg_profit_per_unit: orderTotals.avgProfitPerUnit,
      total_units: orderTotals.totalUnits,
    };

    const itemPayloads = validLines.map((it) => ({
      order_id: editingOrderId ?? "",
      product_id: it.productId,
      treatment_id: it.treatmentId,
      seed_size: it.seedSize || null,
      package_type: it.packageType,
      units: it.units,
      retail_price_per_unit: it.retailPricePerUnit,
      tote_bulk_discount_per_unit: it.toteBulkDiscountPerUnit,
      line_subtotal_before_discounts: it.lineSubtotalBeforeDiscounts,
      brand_grower_discount_amount: it.brandGrowerDiscountAmount,
      tote_bulk_discount_amount: it.toteBulkDiscountAmount,
      line_total_after_discounts_before_early_pay:
        it.lineTotalAfterDiscountsBeforeEarlyPay,
      early_pay_discount_amount: it.earlyPayDiscountAmount,
      line_total_after_all_discounts: it.lineTotalAfterAllDiscounts,
      break_even_price_per_unit: it.breakEvenPricePerUnit,
      profit_per_unit: it.profitPerUnit,
      total_profit: it.totalProfit,
    }));

    try {
      if (editingOrderId) {
        await updateOrder(editingOrderId, orderPayload, itemPayloads);
      } else {
        const newId = await saveOrder(orderPayload, itemPayloads);
        setEditingOrderId(newId);
      }
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save order"
      );
    } finally {
      setSaving(false);
    }
  };

  // Print
  const [printError, setPrintError] = useState<string | null>(null);
  const canPrint =
    !!selectedCustomerId && validLines.length > 0;

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId]
  );

  const printCustomer: PrintCustomer = useMemo(() => {
    if (!selectedCustomer) {
      return { name: "", farmName: "", tsaNumber: "", phone: "", address: "", city: "", province: "", postalCode: "" };
    }
    return {
      name: selectedCustomer.customer_name,
      farmName: selectedCustomer.farm_name ?? "",
      tsaNumber: selectedCustomer.tsa_number ?? "",
      phone: selectedCustomer.phone_number ?? "",
      address: selectedCustomer.address ?? "",
      city: selectedCustomer.city ?? "",
      province: selectedCustomer.province ?? "",
      postalCode: selectedCustomer.postal_code ?? "",
    };
  }, [selectedCustomer]);

  const printItems: PrintItem[] = useMemo(
    () =>
      validLines.map((it) => ({
        product: it.product,
        units: it.units,
        seedSize: it.seedSize,
        packageType: it.packageType,
        treatment: it.treatment,
        retailPricePerUnit: it.retailPricePerUnit,
        pricePerUnitAfterPrograms:
          it.units > 0 ? round2(it.lineTotalAfterAllDiscounts / it.units) : 0,
        lineTotal: it.lineTotalAfterAllDiscounts,
      })),
    [validLines]
  );

  const handlePrint = () => {
    setPrintError(null);
    if (!selectedCustomerId) {
      setPrintError("Select a customer before printing.");
      return;
    }
    if (validLines.length === 0) {
      setPrintError("Add at least one item with a product, treatment, and units > 0.");
      return;
    }
    const printData = {
      orderDate,
      seasonYear,
      customer: printCustomer,
      notes,
      items: printItems,
      brandGrowerPct,
      earlyPayPct,
      totals: {
        totalUnits: orderTotals.totalUnits,
        subtotalBeforeDiscounts: orderTotals.subtotalBeforeDiscounts,
        brandGrowerDiscountTotal: orderTotals.brandGrowerDiscountTotal,
        toteBulkDiscountTotal: orderTotals.toteBulkDiscountTotal,
        subtotalAfterDiscountsBeforeEarlyPay:
          orderTotals.subtotalAfterDiscountsBeforeEarlyPay,
        earlyPayDiscountTotal: orderTotals.earlyPayDiscountTotal,
        totalAfterAllDiscounts: orderTotals.totalAfterAllDiscounts,
      },
    };
    sessionStorage.setItem("ssim-print-data", JSON.stringify(printData));
    window.open("/orders/print", "_blank");
  };

  return (
    <div>
      {/* ---- View Toggle ---- */}
      <div className={styles.viewToggle}>
        <button
          className={`${styles.toggleBtn} ${view === "new" ? styles.toggleActive : ""}`}
          onClick={() => setView("new")}
        >
          {editingOrderId ? "Editing Order" : "New Order"}
        </button>
        <button
          className={`${styles.toggleBtn} ${view === "list" ? styles.toggleActive : ""}`}
          onClick={handleShowList}
        >
          This Season Order Items
        </button>
      </div>

      {dataError && <div className={styles.error}>{dataError}</div>}

      {view === "list" ? (
        /* ---- Orders List View ---- */
        <OrderItemsListTable
          rows={ordersList}
          loading={ordersLoading}
          error={ordersError}
          onEdit={handleEditOrder}
          onDelete={handleDeleteOrder}
        />
      ) : (
        /* ---- Order Form View ---- */
        <>
          <h1 className={styles.heading}>
            {editingOrderId ? "Edit Order" : "New Order"}
          </h1>

          {/* ---- Order Header ---- */}
          <div className={styles.headerGrid}>
            {/* Customer */}
            <div className={styles.field}>
              <label className={styles.label}>Customer</label>
              <div className={styles.customerRow}>
                <SearchableSelect
                  options={customerSelectOptions}
                  value={selectedCustomerId ?? ""}
                  onChange={handleCustomerSelect}
                  placeholder="Search customers…"
                />
                {selectedCustomerId && (
                  <button className={styles.chipRemove} onClick={clearCustomer}>
                    ×
                  </button>
                )}
              </div>
            </div>

            {/* Add Customer action */}
            <div className={styles.field}>
              <label className={styles.label}>&nbsp;</label>
              {!selectedCustomerId && (
                <button
                  className={styles.addCustomerBtn}
                  onClick={() => setShowCustomerPanel(true)}
                >
                  + New Customer
                </button>
              )}
            </div>

            {/* Season Year */}
            <div className={styles.field}>
              <label className={styles.label}>Season</label>
              <span className={styles.readonlyBadge}>
                {seasonYear ?? "—"}
              </span>
            </div>

            {/* Order Date */}
            <div className={styles.field}>
              <label className={styles.label}>Order Date</label>
              <input
                className={styles.input}
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
              />
            </div>

            {/* Notes */}
            <div className={styles.fieldFull}>
              <label className={styles.label}>Notes</label>
              <textarea
                className={styles.textarea}
                rows={2}
                placeholder="Optional notes…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          {/* ---- Inline Customer Panel ---- */}
          <CustomerCreatePanel
            open={showCustomerPanel}
            onClose={() => setShowCustomerPanel(false)}
            onSave={handleCustomerSave}
          />

          {/* ---- Order Items ---- */}
          <div className={styles.sectionLabel}>Order Items</div>
          <OrderItemsTable
            items={items}
            onChange={handleItemsChange}
            pricingOptions={pricingOptions}
          />

          {/* ---- Discounts ---- */}
          <div className={styles.sectionLabel}>Discounts</div>
          <div className={styles.discountControls}>
            <div className={styles.discountField}>
              <label className={styles.discountLabel}>Brand Grower %</label>
              <input
                className={styles.discountInput}
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={brandGrowerPct || ""}
                placeholder="0"
                onChange={(e) =>
                  handleBrandGrowerChange(
                    Math.min(100, Math.max(0, Number(e.target.value) || 0))
                  )
                }
              />
            </div>
            <div className={styles.discountField}>
              <label className={styles.discountLabel}>Early Pay %</label>
              <input
                className={styles.discountInput}
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={earlyPayPct || ""}
                placeholder="0"
                onChange={(e) =>
                  handleEarlyPayChange(
                    Math.min(100, Math.max(0, Number(e.target.value) || 0))
                  )
                }
              />
            </div>
          </div>

          {/* ---- Order Summary ---- */}
          <div className={styles.sectionLabel}>Order Summary</div>
          <div className={styles.orderSummary}>
            <div className={styles.summaryRow}>
              <span>Subtotal before discounts</span>
              <span className={styles.summaryRowValue}>
                ${fmt(orderTotals.subtotalBeforeDiscounts)}
              </span>
            </div>
            <div className={`${styles.summaryRow} ${styles.summaryDiscount}`}>
              <span>Brand grower discount ({brandGrowerPct}%)</span>
              <span className={styles.summaryRowValue}>
                -${fmt(orderTotals.brandGrowerDiscountTotal)}
              </span>
            </div>
            <div className={`${styles.summaryRow} ${styles.summaryDiscount}`}>
              <span>Tote/bulk discount</span>
              <span className={styles.summaryRowValue}>
                -${fmt(orderTotals.toteBulkDiscountTotal)}
              </span>
            </div>

            <div className={styles.summaryDivider} />

            <div className={styles.summaryRow}>
              <span>Subtotal after discounts</span>
              <span className={styles.summaryRowValue}>
                ${fmt(orderTotals.subtotalAfterDiscountsBeforeEarlyPay)}
              </span>
            </div>
            <div className={`${styles.summaryRow} ${styles.summaryDiscount}`}>
              <span>Early pay discount ({earlyPayPct}%)</span>
              <span className={styles.summaryRowValue}>
                -${fmt(orderTotals.earlyPayDiscountTotal)}
              </span>
            </div>

            <div className={styles.summaryDivider} />

            <div className={`${styles.summaryRow} ${styles.summaryBold}`}>
              <span>Total after all discounts</span>
              <span className={styles.summaryRowValue}>
                ${fmt(orderTotals.totalAfterAllDiscounts)}
              </span>
            </div>

            <div className={styles.summaryDivider} />

            <div className={styles.summaryRow}>
              <span>Total units</span>
              <span className={styles.summaryRowValue}>
                {orderTotals.totalUnits}
              </span>
            </div>
            <div
              className={`${styles.summaryRow} ${styles.summaryBold} ${
                orderTotals.totalProfit > 0
                  ? styles.summaryPositive
                  : orderTotals.totalProfit < 0
                  ? styles.summaryNegative
                  : ""
              }`}
            >
              <span>Total profit</span>
              <span className={styles.summaryRowValue}>
                ${fmt(orderTotals.totalProfit)}
              </span>
            </div>
            <div className={styles.summaryRow}>
              <span>Avg profit / unit</span>
              <span className={styles.summaryRowValue}>
                ${orderTotals.avgProfitPerUnit.toFixed(4)}
              </span>
            </div>
          </div>

          {/* ---- Actions ---- */}
          {saveError && <div className={styles.error}>{saveError}</div>}
          {printError && <div className={styles.error}>{printError}</div>}
          {saveSuccess && (
            <div className={styles.success}>
              Order {editingOrderId ? "updated" : "saved"} successfully.
            </div>
          )}
          <div className={styles.actions}>
            <button
              className={styles.saveBtn}
              disabled={!canSave}
              onClick={handleSaveOrder}
            >
              {saving
                ? "Saving…"
                : editingOrderId
                ? "Update Order"
                : "Save Order"}
            </button>
            <button
              className={styles.printBtn}
              disabled={!canPrint}
              onClick={handlePrint}
            >
              Print
            </button>
            <button className={styles.clearBtn} onClick={clearForm}>
              {editingOrderId ? "Cancel Edit" : "Clear Form"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
