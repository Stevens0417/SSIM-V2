import styles from "./OrderPrintView.module.css";

function fmt(n: number): string {
  return n.toFixed(2);
}

export interface PrintItem {
  product: string;
  units: number;
  seedSize: string;
  packageType: string;
  treatment: string;
  retailPricePerUnit: number;
  pricePerUnitAfterPrograms: number;
  lineTotal: number;
}

export interface PrintTotals {
  totalUnits: number;
  subtotalBeforeDiscounts: number;
  brandGrowerDiscountTotal: number;
  toteBulkDiscountTotal: number;
  subtotalAfterDiscountsBeforeEarlyPay: number;
  earlyPayDiscountTotal: number;
  totalAfterAllDiscounts: number;
}

export interface PrintCustomer {
  name: string;
  farmName: string;
  tsaNumber: string;
  phone: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
}

interface Props {
  orderDate: string;
  seasonYear: number | null;
  customer: PrintCustomer;
  notes: string;
  items: PrintItem[];
  brandGrowerPct: number;
  earlyPayPct: number;
  totals: PrintTotals;
}

const MAX_PRINT_ROWS = 8;

export default function OrderPrintView({
  orderDate,
  seasonYear,
  customer,
  notes,
  items,
  brandGrowerPct,
  earlyPayPct,
  totals,
}: Props) {
  const EXTRA_FILLER = 5;
  const multiPage = items.length > MAX_PRINT_ROWS;
  const emptyRowCount = multiPage ? 0 : Math.max(0, MAX_PRINT_ROWS - items.length) + EXTRA_FILLER;
  return (
    <div className={`${styles.page} ${multiPage ? styles.pageMulti : ""}`}>
      {/* ---- Header ---- */}
      <div className={styles.header}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={styles.logo}
          src="/assets/logos/dekalb.png"
          alt="DEKALB"
        />
        <div className={styles.headerText}>
          <div className={styles.headerLine1}>
            {seasonYear ?? ""} Seed Commitment Form
          </div>
          <div className={styles.headerLine2}>Travis Stevens</div>
          <div className={styles.headerLine3}>Stevens Seeds</div>
          <div className={styles.headerLine4}>
            29511 Dawn Mills Rd Dresden Ontario N0P 1M0
          </div>
          <div className={styles.headerLine4}>226-627-7333</div>
        </div>
      </div>

      {/* ---- Grower Information ---- */}
      <div className={`${styles.section} ${styles.sectionGrower}`}>
        <div className={styles.sectionTitle}>Grower Information</div>
        <div className={styles.sectionBody}>
          <div className={styles.infoGrid}>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Name:</span>
              <span className={styles.infoValue}>{customer.name}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Farm Name:</span>
              <span className={styles.infoValue}>{customer.farmName}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>TSA #:</span>
              <span className={styles.infoValue}>{customer.tsaNumber}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Address:</span>
              <span className={styles.infoValue}>{customer.address}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>City:</span>
              <span className={styles.infoValue}>{customer.city}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Province:</span>
              <span className={styles.infoValue}>{customer.province}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Postal Code:</span>
              <span className={styles.infoValue}>{customer.postalCode}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Telephone:</span>
              <span className={styles.infoValue}>{customer.phone}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Date:</span>
              <span className={styles.infoValue}>{orderDate}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ---- Order Items ---- */}
      <div className={`${styles.section} ${multiPage ? styles.sectionItemsMulti : styles.sectionItems}`}>
        <div className={styles.sectionTitle}>Order Items</div>
        <table className={styles.itemsTable}>
          <thead>
            <tr>
              <th className={styles.colProduct}>Product</th>
              <th className={styles.colQty} style={{ textAlign: "right" }}>Qty</th>
              <th className={styles.colSize}>Seed Size</th>
              <th className={styles.colPkg}>Package Type</th>
              <th className={styles.colTreatment}>Treatment</th>
              <th className={styles.colRetail} style={{ textAlign: "right" }}>Retail $/U</th>
              <th className={styles.colNet} style={{ textAlign: "right" }}>Price/U After Programs</th>
              <th className={styles.colTotal} style={{ textAlign: "right" }}>Total Price</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td>{it.product}</td>
                <td className={styles.numCell}>{it.units}</td>
                <td>{it.seedSize || "\u2014"}</td>
                <td>{it.packageType}</td>
                <td>{it.treatment}</td>
                <td className={styles.numCell}>${fmt(it.retailPricePerUnit)}</td>
                <td className={styles.numCell}>${fmt(it.pricePerUnitAfterPrograms)}</td>
                <td className={styles.numCell}>${fmt(it.lineTotal)}</td>
              </tr>
            ))}
            {Array.from({ length: emptyRowCount }).map((_, i) => (
              <tr key={`empty-${i}`} className={styles.emptyRow}>
                <td>&nbsp;</td>
                <td />
                <td />
                <td />
                <td />
                <td />
                <td />
                <td />
              </tr>
            ))}
            <tr className={styles.totalRow}>
              <td>TOTAL</td>
              <td className={styles.numCell}>{totals.totalUnits}</td>
              <td colSpan={4}></td>
              <td></td>
              <td className={styles.numCell}>${fmt(totals.totalAfterAllDiscounts)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ---- Program Discounts ---- */}
        <div className={`${styles.section} ${styles.sectionDiscounts} ${multiPage ? styles.footerBlock : ""}`}>
          <div className={styles.sectionTitle}>Program Discounts</div>
          <div className={styles.discountsBody}>
            <div className={styles.discountsGrid}>
              <span className={styles.discountLabel}>Subtotal before discounts</span>
              <span className={styles.discountValue}>${fmt(totals.subtotalBeforeDiscounts)}</span>

              <span className={styles.discountLabel}>
                Brand Grower discount ({brandGrowerPct}%)
              </span>
              <span className={styles.discountValue}>
                &minus;${fmt(totals.brandGrowerDiscountTotal)}
              </span>

              <span className={styles.discountLabel}>Tote / Bulk discount</span>
              <span className={styles.discountValue}>
                &minus;${fmt(totals.toteBulkDiscountTotal)}
              </span>

              <div className={styles.discountDivider} />

              <span className={`${styles.discountLabel} ${styles.discountBold}`}>
                Subtotal after discounts
              </span>
              <span className={`${styles.discountValue} ${styles.discountBold}`}>
                ${fmt(totals.subtotalAfterDiscountsBeforeEarlyPay)}
              </span>

              <span className={styles.discountLabel}>
                Early Pay discount ({earlyPayPct}%)
              </span>
              <span className={styles.discountValue}>
                &minus;${fmt(totals.earlyPayDiscountTotal)}
              </span>

              <div className={styles.discountDivider} />

              <span className={`${styles.discountLabel} ${styles.grandTotal}`}>
                Total after all discounts
              </span>
              <span className={`${styles.discountValue} ${styles.grandTotal}`}>
                ${fmt(totals.totalAfterAllDiscounts)}
              </span>
            </div>
          </div>
        </div>

        {/* ---- Comments ---- */}
        <div className={`${styles.section} ${styles.sectionComments}`}>
          <div className={styles.sectionTitle}>Comments</div>
          <div className={styles.sectionBody}>
            <div className={styles.commentsBox}>{notes || "\u00A0"}</div>
          </div>
        </div>

        {/* ---- Signatures ---- */}
        <div className={`${styles.section} ${styles.sectionSignatures}`}>
          <div className={styles.sectionTitle}>Signatures</div>
          <div className={styles.sectionBody}>
            <div className={styles.sigGrid}>
              <div className={styles.sigLine}>
                <span className={styles.sigLabel}>Grower:</span>
                <span className={styles.sigBlank} />
              </div>
              <div className={styles.sigLine}>
                <span className={styles.sigLabel}>Date:</span>
                <span className={styles.sigBlank} />
              </div>
              <div className={styles.sigLine}>
                <span className={styles.sigLabel}>Dealer:</span>
                <span className={styles.sigBlank} />
              </div>
              <div className={styles.sigLine}>
                <span className={styles.sigLabel}>Date:</span>
                <span className={styles.sigBlank} />
              </div>
            </div>
          </div>
        </div>
    </div>
  );
}
