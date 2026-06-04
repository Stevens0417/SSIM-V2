"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  fetchCustomerAdjustmentReport,
  type CustomerAdjustmentReport,
} from "@/services/customerAdjustmentReport.service";
import {
  fetchCustomers,
  type CustomerOption,
} from "@/services/customer.service";
import SearchableSelect from "@/components/orders/SearchableSelect";
import { fmtCurrency, fmtPackageType } from "@/lib/fmt";
import styles from "./CustomerReportTab.module.css";

interface Props {
  seasons: number[];
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-CA");
}

function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

function fmtEarlyPayBucket(bucket: string): string {
  if (bucket === "EARLY_PAY") return "Early Pay";
  if (bucket === "NO_EARLY_PAY") return "No Early Pay";
  return bucket;
}

export default function CustomerReportTab({ seasons }: Props) {
  const [selectedSeason, setSelectedSeason] = useState<number | null>(
    seasons.length > 0 ? seasons[0] : null
  );
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");

  const [report, setReport] = useState<CustomerAdjustmentReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);

  const reportRef = useRef<HTMLDivElement>(null);

  // Keep selectedSeason in sync when seasons prop changes
  useEffect(() => {
    if (seasons.length > 0 && selectedSeason === null) {
      setSelectedSeason(seasons[0]);
    }
  }, [seasons, selectedSeason]);

  // Load customers once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchCustomers();
        if (!cancelled) setCustomers(data);
      } catch {
        // non-fatal: customer list will be empty
      } finally {
        if (!cancelled) setCustomersLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const customerOptions = useMemo(
    () =>
      customers.map((c) => ({
        value: c.id,
        label: c.farm_name
          ? `${c.customer_name} — ${c.farm_name}`
          : c.customer_name,
      })),
    [customers]
  );

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);

  function handleSeasonChange(year: number) {
    setSelectedSeason(year);
    // Reset report when season changes
    setReport(null);
    setReportError(null);
    setGeneratedAt(null);
  }

  function handleCustomerChange(id: string) {
    setSelectedCustomerId(id);
    setReport(null);
    setReportError(null);
    setGeneratedAt(null);
  }

  async function handleGenerate() {
    if (!selectedSeason || !selectedCustomerId) return;
    setReportLoading(true);
    setReportError(null);
    setReport(null);
    setGeneratedAt(null);
    try {
      const data = await fetchCustomerAdjustmentReport(
        selectedSeason,
        selectedCustomerId
      );
      setReport(data);
      setGeneratedAt(new Date());
    } catch (err) {
      setReportError(
        err instanceof Error ? err.message : "Failed to load report"
      );
    } finally {
      setReportLoading(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  // KPI totals computed from summary rows
  const kpis = useMemo(() => {
    if (!report) return null;
    const totalOrdered = report.summary.reduce((s, r) => s + r.units_ordered, 0);
    const totalDelivered = report.summary.reduce((s, r) => s + r.units_delivered, 0);
    const totalReplanted = report.summary.reduce((s, r) => s + r.units_replanted, 0);
    const totalReturned = report.summary.reduce((s, r) => s + r.units_returned, 0);
    const netUnits = totalOrdered - totalDelivered - totalReplanted + totalReturned;
    return { totalOrdered, totalDelivered, totalReplanted, totalReturned, netUnits };
  }, [report]);

  const canGenerate = !!selectedSeason && !!selectedCustomerId;

  return (
    <div>
      {/* ---- Controls ---- */}
      <div className={styles.controlsBar}>
        <label className={styles.label}>Season</label>
        <select
          className={styles.select}
          value={selectedSeason ?? ""}
          onChange={(e) => handleSeasonChange(Number(e.target.value))}
        >
          {seasons.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <label className={styles.label}>Customer</label>
        <div className={styles.customerWrap}>
          <SearchableSelect
            options={customerOptions}
            value={selectedCustomerId}
            onChange={handleCustomerChange}
            placeholder={customersLoading ? "Loading…" : "Select customer"}
            disabled={customersLoading}
          />
          {selectedCustomerId && (
            <button
              className={styles.clearBtn}
              onClick={() => handleCustomerChange("")}
            >
              ×
            </button>
          )}
        </div>

        <button
          className={styles.generateBtn}
          onClick={handleGenerate}
          disabled={!canGenerate || reportLoading}
        >
          {reportLoading ? "Loading…" : "Generate Report"}
        </button>

        {report && (
          <button className={styles.printBtn} onClick={handlePrint}>
            Print Report
          </button>
        )}
      </div>

      {/* ---- States ---- */}
      {reportError && <div className={styles.error}>{reportError}</div>}

      {!reportLoading && !report && !reportError && (
        <div className={styles.empty}>
          {!selectedCustomerId
            ? "Select a customer to generate the report."
            : "Click Generate Report to load data."}
        </div>
      )}

      {reportLoading && (
        <div className={styles.loading}>Loading report…</div>
      )}

      {/* ---- Report ---- */}
      {report && selectedCustomer && generatedAt && kpis && (
        <div className={styles.report} ref={reportRef}>
          {/* Section 1: Header */}
          <div className={styles.reportHeader}>
            <div className={styles.reportTitle}>Customer Adjustment Report</div>
            <div className={styles.reportMeta}>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Season</span>
                <span className={styles.metaValue}>{selectedSeason}</span>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Customer</span>
                <span className={styles.metaValue}>
                  {selectedCustomer.customer_name}
                </span>
              </div>
              {selectedCustomer.farm_name && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Farm</span>
                  <span className={styles.metaValue}>
                    {selectedCustomer.farm_name}
                  </span>
                </div>
              )}
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Generated</span>
                <span className={styles.metaValue}>
                  {generatedAt.toLocaleDateString("en-CA")}
                </span>
              </div>
            </div>
          </div>

          {/* Section 2: Customer Summary KPIs */}
          <div className={styles.kpiRow}>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Units Ordered</div>
              <div className={styles.kpiValue}>{kpis.totalOrdered}</div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Units Delivered</div>
              <div className={styles.kpiValue}>{kpis.totalDelivered}</div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Units Replanted</div>
              <div className={styles.kpiValue}>{kpis.totalReplanted}</div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Units Returned</div>
              <div className={styles.kpiValue}>{kpis.totalReturned}</div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Net Adjustment</div>
              <div
                className={`${styles.kpiValueNet} ${
                  kpis.netUnits !== 0
                    ? styles.kpiValueNetNonzero
                    : styles.kpiValueNetZero
                }`}
              >
                {kpis.netUnits}
              </div>
            </div>
          </div>

          {/* Section 3: Orders */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Orders</div>
            {report.orders.length === 0 ? (
              <div className={styles.noRows}>No orders found.</div>
            ) : (
              <div className={styles.wrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Order Date</th>
                      <th>Order ID</th>
                      <th>Product</th>
                      <th>Treatment</th>
                      <th>Seed Size</th>
                      <th>Package Type</th>
                      <th className={styles.right}>Retail Price</th>
                      <th className={styles.right}>Sale Price</th>
                      <th className={styles.right}>Units</th>
                      <th className={styles.right}>Early Pay %</th>
                      <th className={styles.right}>Brand Grower %</th>
                      <th className={styles.right}>Total Disc %</th>
                      <th className={styles.right}>Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.orders.map((r) => (
                      <tr key={r.order_id + r.product_id + r.treatment_id + (r.seed_size ?? "") + r.package_type}>
                        <td>{fmtDate(r.order_date)}</td>
                        <td title={r.order_id}>{shortId(r.order_id)}</td>
                        <td>{r.product_name}</td>
                        <td>{r.treatment_name}</td>
                        <td>{r.seed_size ?? "—"}</td>
                        <td>{fmtPackageType(r.package_type)}</td>
                        <td className={styles.mono}>{fmtCurrency(r.retail_price_per_unit)}</td>
                        <td className={styles.mono}>{fmtCurrency(r.sale_price_per_unit)}</td>
                        <td className={styles.mono}>{r.units_ordered}</td>
                        <td className={styles.mono}>{r.early_pay_discount_pct}%</td>
                        <td className={styles.mono}>{r.brand_grower_discount_pct}%</td>
                        <td className={styles.mono}>{r.total_discount_pct}%</td>
                        <td className={styles.mono}>{fmtCurrency(r.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section 4: Deliveries */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Deliveries</div>
            {report.deliveries.length === 0 ? (
              <div className={styles.noRows}>No deliveries found.</div>
            ) : (
              <div className={styles.wrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Delivery Date</th>
                      <th>Delivery ID</th>
                      <th>Product</th>
                      <th>Treatment</th>
                      <th>Seed Size</th>
                      <th>Package Type</th>
                      <th className={styles.right}>Units Delivered</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.deliveries.map((r) => (
                      <tr key={r.delivery_id}>
                        <td>{fmtDate(r.delivery_date)}</td>
                        <td title={r.delivery_id}>{shortId(r.delivery_id)}</td>
                        <td>{r.product_name}</td>
                        <td>{r.treatment_name}</td>
                        <td>{r.seed_size ?? "—"}</td>
                        <td>{fmtPackageType(r.package_type)}</td>
                        <td className={styles.mono}>{r.units_delivered}</td>
                        <td>{r.notes ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section 5: Replants */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Replants</div>
            {report.replants.length === 0 ? (
              <div className={styles.noRows}>No replants found.</div>
            ) : (
              <div className={styles.wrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Replant Date</th>
                      <th>Replant ID</th>
                      <th>Product</th>
                      <th>Treatment</th>
                      <th>Seed Size</th>
                      <th>Package Type</th>
                      <th className={styles.right}>Units Replanted</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.replants.map((r) => (
                      <tr key={r.replant_id}>
                        <td>{fmtDate(r.replant_date)}</td>
                        <td title={r.replant_id}>{shortId(r.replant_id)}</td>
                        <td>{r.product_name}</td>
                        <td>{r.treatment_name}</td>
                        <td>{r.seed_size ?? "—"}</td>
                        <td>{fmtPackageType(r.package_type)}</td>
                        <td className={styles.mono}>{r.units_replanted}</td>
                        <td>{r.notes ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section 6: Returns */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Returns</div>
            {report.returns.length === 0 ? (
              <div className={styles.noRows}>No returns found.</div>
            ) : (
              <div className={styles.wrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Return Date</th>
                      <th>Return ID</th>
                      <th>Product</th>
                      <th>Treatment</th>
                      <th>Seed Size</th>
                      <th>Package Type</th>
                      <th className={styles.right}>Units Returned</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.returns.map((r) => (
                      <tr key={r.return_id}>
                        <td>{fmtDate(r.return_date)}</td>
                        <td title={r.return_id}>{shortId(r.return_id)}</td>
                        <td>{r.product_name}</td>
                        <td>{r.treatment_name}</td>
                        <td>{r.seed_size ?? "—"}</td>
                        <td>{fmtPackageType(r.package_type)}</td>
                        <td className={styles.mono}>{r.units_returned}</td>
                        <td>{r.notes ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section 7: Reconciliation Summary */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Reconciliation Summary</div>
            {report.summary.length === 0 ? (
              <div className={styles.noRows}>No reconciliation rows found.</div>
            ) : (
              <div className={styles.wrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Treatment</th>
                      <th>Seed Size</th>
                      <th>Package Type</th>
                      <th>Early Pay</th>
                      <th className={styles.right}>Ordered</th>
                      <th className={styles.right}>Delivered</th>
                      <th className={styles.right}>Replanted</th>
                      <th className={styles.right}>Returned</th>
                      <th className={styles.right}>Net Units</th>
                      <th className={styles.center}>Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.summary.map((r, i) => (
                      <tr
                        key={`${r.product_id}-${r.treatment_id}-${r.seed_size ?? ""}-${r.package_type}-${r.early_pay_bucket}-${i}`}
                      >
                        <td>{r.product_name}</td>
                        <td>{r.treatment_name}</td>
                        <td>{r.seed_size ?? "—"}</td>
                        <td>{fmtPackageType(r.package_type)}</td>
                        <td>{fmtEarlyPayBucket(r.early_pay_bucket)}</td>
                        <td className={styles.mono}>{r.units_ordered}</td>
                        <td className={styles.mono}>{r.units_delivered}</td>
                        <td className={styles.mono}>{r.units_replanted}</td>
                        <td className={styles.mono}>{r.units_returned}</td>
                        <td
                          className={`${styles.mono} ${r.net_units !== 0 ? styles.netHighlight : ""}`}
                        >
                          {r.net_units}
                        </td>
                        <td className={styles.center}>
                          <span
                            className={`${styles.completedBadge} ${
                              r.completed ? styles.completedYes : styles.completedNo
                            }`}
                          >
                            {r.completed ? "Yes" : "No"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
