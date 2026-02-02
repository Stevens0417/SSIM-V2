"use client";

import { useState } from "react";
import styles from "./CustomerCreatePanel.module.css";

export interface CustomerDraft {
  customer_name: string;
  phone_number: string;
  address: string;
  city: string;
  province: string;
  postal_code: string;
  farm_name: string;
  tsa_number: string;
}

const EMPTY: CustomerDraft = {
  customer_name: "",
  phone_number: "",
  address: "",
  city: "",
  province: "",
  postal_code: "",
  farm_name: "",
  tsa_number: "",
};

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (data: CustomerDraft) => Promise<void>;
}

export default function CustomerCreatePanel({ open, onClose, onSave }: Props) {
  const [form, setForm] = useState<CustomerDraft>({ ...EMPTY });
  const [errors, setErrors] = useState<Partial<Record<keyof CustomerDraft, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!open) return null;

  const set = (key: keyof CustomerDraft, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
    if (saveError) setSaveError(null);
  };

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (!form.customer_name.trim()) next.customer_name = "Customer name is required";
    if (!form.phone_number.trim()) next.phone_number = "Phone number is required";
    if (!form.address.trim()) next.address = "Address is required";
    if (!form.city.trim()) next.city = "City is required";
    if (!form.province.trim()) next.province = "Province is required";
    if (!form.postal_code.trim()) next.postal_code = "Postal code is required";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(form);
      setForm({ ...EMPTY });
      setErrors({});
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save customer"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setForm({ ...EMPTY });
    setErrors({});
    setSaveError(null);
    onClose();
  };

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>New Customer</span>
        <button className={styles.closeBtn} onClick={handleClose}>×</button>
      </div>

      <div className={styles.grid}>
        <div className={styles.field}>
          <label className={`${styles.label} ${styles.required}`}>Customer Name</label>
          <input
            className={`${styles.input} ${errors.customer_name ? styles.inputError : ""}`}
            value={form.customer_name}
            onChange={(e) => set("customer_name", e.target.value)}
            placeholder="Customer name"
          />
          {errors.customer_name && <span className={styles.errorText}>{errors.customer_name}</span>}
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Farm Name</label>
          <input
            className={styles.input}
            value={form.farm_name}
            onChange={(e) => set("farm_name", e.target.value)}
            placeholder="Farm name (optional)"
          />
        </div>

        <div className={styles.field}>
          <label className={`${styles.label} ${styles.required}`}>Phone Number</label>
          <input
            className={`${styles.input} ${errors.phone_number ? styles.inputError : ""}`}
            value={form.phone_number}
            onChange={(e) => set("phone_number", e.target.value)}
            placeholder="Phone number"
          />
          {errors.phone_number && <span className={styles.errorText}>{errors.phone_number}</span>}
        </div>

        <div className={styles.field}>
          <label className={styles.label}>TSA Number</label>
          <input
            className={styles.input}
            value={form.tsa_number}
            onChange={(e) => set("tsa_number", e.target.value)}
            placeholder="TSA number (optional)"
          />
        </div>

        <div className={styles.field}>
          <label className={`${styles.label} ${styles.required}`}>Address</label>
          <input
            className={`${styles.input} ${errors.address ? styles.inputError : ""}`}
            value={form.address}
            onChange={(e) => set("address", e.target.value)}
            placeholder="Street address"
          />
          {errors.address && <span className={styles.errorText}>{errors.address}</span>}
        </div>

        <div className={styles.field}>
          <label className={`${styles.label} ${styles.required}`}>City</label>
          <input
            className={`${styles.input} ${errors.city ? styles.inputError : ""}`}
            value={form.city}
            onChange={(e) => set("city", e.target.value)}
            placeholder="City"
          />
          {errors.city && <span className={styles.errorText}>{errors.city}</span>}
        </div>

        <div className={styles.field}>
          <label className={`${styles.label} ${styles.required}`}>Province</label>
          <input
            className={`${styles.input} ${errors.province ? styles.inputError : ""}`}
            value={form.province}
            onChange={(e) => set("province", e.target.value)}
            placeholder="Province"
          />
          {errors.province && <span className={styles.errorText}>{errors.province}</span>}
        </div>

        <div className={styles.field}>
          <label className={`${styles.label} ${styles.required}`}>Postal Code</label>
          <input
            className={`${styles.input} ${errors.postal_code ? styles.inputError : ""}`}
            value={form.postal_code}
            onChange={(e) => set("postal_code", e.target.value)}
            placeholder="Postal code"
          />
          {errors.postal_code && <span className={styles.errorText}>{errors.postal_code}</span>}
        </div>
      </div>

      {saveError && (
        <div className={styles.saveError}>{saveError}</div>
      )}

      <div className={styles.actions}>
        <button
          className={styles.saveBtn}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save Customer"}
        </button>
        <button className={styles.cancelBtn} onClick={handleClose} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  );
}
