import styles from "./BayerShipmentPrintView.module.css";

export interface BayerShipmentPrintItem {
  product: string;
  treatment: string;
  units: number;
  seedSize: string | null;
  packageType: string;
}

interface Props {
  shipmentDate: string;
  shipmentNumber: string;
  seasonYear: number;
  items: BayerShipmentPrintItem[];
}

export default function BayerShipmentPrintView({
  shipmentDate,
  shipmentNumber,
  seasonYear,
  items,
}: Props) {
  const totalUnits = items.reduce((sum, it) => sum + it.units, 0);

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
          <div className={styles.headerLine1}>Bayer Shipment Receipt</div>
          <div className={styles.headerLine2}>Travis Stevens</div>
          <div className={styles.headerLine3}>Stevens Seeds</div>
          <div className={styles.headerLine4}>
            29511 Dawn Mills Rd Dresden Ontario N0P 1M0
          </div>
          <div className={styles.headerLine4}>226-627-7333</div>
        </div>
      </div>

      {/* ---- Shipment Info ---- */}
      <div className={`${styles.section} ${styles.sectionInfo}`}>
        <div className={styles.sectionTitle}>Shipment Information</div>
        <div className={styles.sectionBody}>
          <div className={styles.infoGrid}>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Shipment #:</span>
              <span className={styles.infoValue}>{shipmentNumber}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Shipment Date:</span>
              <span className={styles.infoValue}>{shipmentDate}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Season:</span>
              <span className={styles.infoValue}>{seasonYear}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ---- Shipment Items ---- */}
      <div className={`${styles.section} ${styles.sectionItems}`}>
        <div className={styles.sectionTitle}>Shipment Items</div>
        <table className={styles.itemsTable}>
          <thead>
            <tr>
              <th className={styles.colProduct}>Product</th>
              <th className={styles.colTreatment}>Treatment</th>
              <th className={styles.colSize}>Size</th>
              <th className={styles.colUnits}>Units Received</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td>{it.product}</td>
                <td>{it.treatment}</td>
                <td className={styles.centerCell}>{it.seedSize || "—"}</td>
                <td className={styles.numCell}>{it.units}</td>
              </tr>
            ))}
            <tr className={styles.totalRow}>
              <td colSpan={3}>TOTAL UNITS</td>
              <td className={styles.numCell}>{totalUnits}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
