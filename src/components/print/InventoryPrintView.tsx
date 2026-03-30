import type { InventoryPrintRow } from "@/services/inventory.service";
import styles from "./InventoryPrintView.module.css";

interface Props {
  rows: InventoryPrintRow[];
  printDate: string;
}

export default function InventoryPrintView({ rows, printDate }: Props) {
  const totalUnits = rows.reduce((sum, r) => sum + r.units_on_hand, 0);

  // Split into corn and other (beans/soybean/packaging excluded by view)
  const cornRows = rows.filter((r) => r.crop?.toLowerCase() === "corn");
  const beanRows = rows.filter((r) => r.crop?.toLowerCase() !== "corn");

  const renderRows = (subset: InventoryPrintRow[]) =>
    subset.map((row, i) => (
      <tr key={`${row.product_id}-${row.treatment_id}-${row.seed_size ?? ""}-${i}`}>
        <td>{row.product_name}</td>
        <td>{row.treatment_name}</td>
        <td className={styles.center}>{row.seed_size || "—"}</td>
        <td className={styles.right}>{row.units_on_hand.toLocaleString()}</td>
      </tr>
    ));

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>On-Hand Inventory — Stevens Seeds</div>
        <div className={styles.headerMeta}>
          <span>Printed: {printDate}</span>
          <span className={styles.headerTotal}>
            Total Units On Hand: {totalUnits.toLocaleString()}
          </span>
        </div>
      </div>

      <table className={styles.table}>
        <colgroup>
          <col className={styles.colProduct} />
          <col className={styles.colTreatment} />
          <col className={styles.colSize} />
          <col className={styles.colUnits} />
        </colgroup>
        <thead>
          <tr>
            <th>Product</th>
            <th>Treatment</th>
            <th className={styles.center}>Size</th>
            <th className={styles.right}>Units On Hand</th>
          </tr>
        </thead>
        <tbody>
          {cornRows.length > 0 && (
            <tr className={styles.cropDivider}>
              <td colSpan={4}>Corn</td>
            </tr>
          )}
          {renderRows(cornRows)}
          {beanRows.length > 0 && (
            <tr className={styles.cropDivider}>
              <td colSpan={4}>Soybean</td>
            </tr>
          )}
          {renderRows(beanRows)}
        </tbody>
      </table>

      <div className={styles.footer}>Stevens Seeds Inventory Management</div>
    </div>
  );
}
