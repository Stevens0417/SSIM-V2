"use client";

import { useState, useEffect, useMemo } from "react";
import {
  fetchCustomerSummaryReport,
  buildMovementSummary,
  computeSummaryTotals,
  type CustomerSummaryReport,
} from "@/services/customerSummary.service";
import {
  fetchCustomers,
  type CustomerOption,
} from "@/services/customer.service";
import SearchableSelect from "@/components/orders/SearchableSelect";
import { fmtPackageType } from "@/lib/fmt";
import styles from "./CustomerSummaryTab.module.css";

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

export default function CustomerSummaryTab({ seasons }: Props) {
  const [selectedSeason, setSelectedSeason] = useState<number | null>(
    seasons.length > 0 ? seasons[0] : null
  );
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");

  const [report, setReport] = useState<CustomerSummaryReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);

  // Keep selectedSeason in sync when seasons prop arrives
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
    return () => {
      cancelled = true;
    };
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

  // Auto-generate the summary whenever a season + customer are selected.
  useEffect(() => {
    if (!selectedSeason || !selectedCustomerId) {
      setReport(null);
      setReportError(null);
      setGeneratedAt(null);
      return;
    }

    let cancelled = false;
    setReportLoading(true);
    setReportError(null);
    setReport(null);
    setGeneratedAt(null);

    (async () => {
      try {
        const data = await fetchCustomerSummaryReport(
          selectedSeason,
          selectedCustomerId
        );
        if (cancelled) return;
        setReport(data);
        setGeneratedAt(new Date());
      } catch (err) {
        if (!cancelled) {
          setReportError(
            err instanceof Error ? err.message : "Failed to load summary"
          );
        }
      } finally {
        if (!cancelled) setReportLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedSeason, selectedCustomerId]);

  function handlePrint() {
    document.body.classList.add("printing-customer-summary");
    window.print();
    document.body.classList.remove("printing-customer-summary");
  }

  const totals = useMemo(
    () =>
      report
        ? computeSummaryTotals(report.deliveries, report.returns, report.replants)
        : null,
    [report]
  );

  const movement = useMemo(
    () =>
      report
        ? buildMovementSummary(report.deliveries, report.returns, report.replants)
        : [],
    [report]
  );

  return (
    <div>
      {/* ---- Controls ---- */}
      <div className={styles.controlsBar}>
        <label className={styles.label}>Season</label>
        <select
          className={styles.select}
          value={selectedSeason ?? ""}
          onChange={(e) => setSelectedSeason(Number(e.target.value))}
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
            onChange={setSelectedCustomerId}
            placeholder={customersLoading ? "Loading…" : "Select customer"}
            disabled={customersLoading}
          />
          {selectedCustomerId && (
            <button
              className={styles.clearBtn}
              onClick={() => setSelectedCustomerId("")}
            >
              ×
            </button>
          )}
        </div>

        {report && (
          <button className={styles.printBtn} onClick={handlePrint}>
            Print Summary
          </button>
        )}
      </div>

      {/* ---- States ---- */}
      {reportError && <div className={styles.error}>{reportError}</div>}

      {!selectedCustomerId && !reportError && (
        <div className={styles.empty}>
          Select a customer to generate the summary.
        </div>
      )}

      {selectedCustomerId && reportLoading && (
        <div className={styles.loading}>Loading summary…</div>
      )}

      {/* ---- Summary ---- */}
      {report && selectedCustomer && generatedAt && totals && (
        <div className={styles.report}>
          {/* Section 1: Header */}
          <div className={styles.reportHeader}>
            <div className={styles.reportTitle}>Customer Summary</div>
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

          {/* Section 2: Summary Totals */}
          <div className={styles.kpiRow}>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Total Units Delivered</div>
              <div className={styles.kpiValue}>{totals.totalDelivered}</div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Total Units Returned</div>
              <div className={styles.kpiValue}>{totals.totalReturned}</div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Total Units Replanted</div>
              <div className={styles.kpiValue}>{totals.totalReplanted}</div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Net Physical Units</div>
              <div className={styles.kpiValueNet}>{totals.netPhysical}</div>
            </div>
          </div>

          {/* Section 3: Deliveries */}
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

          {/* Section 4: Returns */}
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

          {/* Section 6: Movement Summary by Product */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Movement Summary by Product</div>
            {movement.length === 0 ? (
              <div className={styles.noRows}>No product movement found.</div>
            ) : (
              <div className={styles.wrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Treatment</th>
                      <th>Seed Size</th>
                      <th>Package Type</th>
                      <th className={styles.right}>Delivered</th>
                      <th className={styles.right}>Returned</th>
                      <th className={styles.right}>Replanted</th>
                      <th className={styles.right}>Net Physical Units</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movement.map((r) => (
                      <tr
                        key={`${r.product_id}-${r.treatment_id}-${r.seed_size ?? ""}-${r.package_type}`}
                      >
                        <td>{r.product_name}</td>
                        <td>{r.treatment_name}</td>
                        <td>{r.seed_size ?? "—"}</td>
                        <td>{fmtPackageType(r.package_type)}</td>
                        <td className={styles.mono}>{r.units_delivered}</td>
                        <td className={styles.mono}>{r.units_returned}</td>
                        <td className={styles.mono}>{r.units_replanted}</td>
                        <td className={styles.mono}>{r.net_physical_units}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section 7: Packaging Summary (only when activity exists) */}
          {report.packaging.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Packaging Summary</div>
              <div className={styles.sectionDesc}>
                Pallets and seedpaks are tracked separately from seed product
                movement.
              </div>
              <div className={styles.wrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Packaging Item</th>
                      <th className={styles.right}>Delivered</th>
                      <th className={styles.right}>Returned</th>
                      <th className={styles.right}>Net Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.packaging.map((r) => (
                      <tr key={r.packaging_item}>
                        <td>{r.packaging_item}</td>
                        <td className={styles.mono}>{r.units_delivered}</td>
                        <td className={styles.mono}>{r.units_returned}</td>
                        <td className={styles.mono}>{r.net_outstanding}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
