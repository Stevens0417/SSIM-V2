import styles from "./DeliveryPrintView.module.css";

export interface DeliveryPrintItem {
  product: string;
  treatment: string;
  units: number;
}

export interface DeliveryPrintCustomer {
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
  deliveryDate: string;
  customer: DeliveryPrintCustomer;
  items: DeliveryPrintItem[];
  notes: string;
}

const MAX_PRINT_ROWS = 11;
const EXTRA_FILLER = 0;

export default function DeliveryPrintView({
  deliveryDate,
  customer,
  items,
  notes,
}: Props) {
  const totalUnits = items.reduce((sum, it) => sum + it.units, 0);
  const emptyRowCount = Math.max(0, MAX_PRINT_ROWS - items.length) + EXTRA_FILLER;

  return (
    <div className={styles.page}>
      {/* ---- Header ---- */}
      <div className={styles.header}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={styles.logo}
          src="/assets/logos/dekalb.png"
          alt="DEKALB"
        />
        <div className={styles.headerText}>
          <div className={styles.headerLine1}>Seed Delivery Form</div>
          <div className={styles.headerLine2}>Travis Stevens</div>
          <div className={styles.headerLine3}>Stevens Seeds</div>
          <div className={styles.headerLine4}>
            29511 Dawn Mills Rd Dresden Ontario N0P 1M0
          </div>
          <div className={styles.headerLine4}>226-627-7333</div>
        </div>
      </div>

      {/* ---- Customer Information ---- */}
      <div className={`${styles.section} ${styles.sectionCustomer}`}>
        <div className={styles.sectionTitle}>Customer Information</div>
        <div className={styles.sectionBody}>
          <div className={styles.infoGrid}>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Name:</span>
              <span className={styles.infoValue}>{customer.name}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Delivery Date:</span>
              <span className={styles.infoValue}>{deliveryDate}</span>
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
              <span className={styles.infoLabel}>Telephone:</span>
              <span className={styles.infoValue}>{customer.phone}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ---- Delivery Items ---- */}
      <div className={`${styles.section} ${styles.sectionItems}`}>
        <div className={styles.sectionTitle}>Delivery Items</div>
        <table className={styles.itemsTable}>
          <thead>
            <tr>
              <th className={styles.colProduct}>Product</th>
              <th className={styles.colTreatment}>Treatment</th>
              <th className={styles.colUnits}>Units Delivered</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td>{it.product}</td>
                <td>{it.treatment}</td>
                <td className={styles.numCell}>{it.units}</td>
              </tr>
            ))}
            {Array.from({ length: emptyRowCount }).map((_, i) => (
              <tr key={`empty-${i}`} className={styles.emptyRow}>
                <td>&nbsp;</td>
                <td />
                <td />
              </tr>
            ))}
            <tr className={styles.totalRow}>
              <td colSpan={2}>TOTAL UNITS</td>
              <td className={styles.numCell}>{totalUnits}</td>
            </tr>
          </tbody>
        </table>
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
