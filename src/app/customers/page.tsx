"use client";

import { useState, useEffect, useMemo } from "react";
import {
  fetchCustomers,
  insertCustomer,
  updateCustomer,
  deleteCustomer,
  type CustomerOption,
} from "@/services/customer.service";
import styles from "./customers.module.css";

type FormMode = "add" | "edit" | null;

interface FormState {
  customer_name: string;
  farm_name: string;
  phone_number: string;
  address: string;
  city: string;
  province: string;
  postal_code: string;
  tsa_number: string;
}

const emptyForm = (): FormState => ({
  customer_name: "",
  farm_name: "",
  phone_number: "",
  address: "",
  city: "",
  province: "",
  postal_code: "",
  tsa_number: "",
});

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadCustomers = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchCustomers();
      setCustomers(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load customers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return customers;
    const term = searchTerm.toLowerCase();
    return customers.filter(
      (c) =>
        c.customer_name.toLowerCase().includes(term) ||
        (c.farm_name ?? "").toLowerCase().includes(term) ||
        (c.city ?? "").toLowerCase().includes(term) ||
        (c.tsa_number ?? "").toLowerCase().includes(term)
    );
  }, [customers, searchTerm]);

  const openAdd = () => {
    setForm(emptyForm());
    setNameError(null);
    setFormError(null);
    setEditingId(null);
    setFormMode("add");
    setSuccessMsg(null);
  };

  const openEdit = (customer: CustomerOption) => {
    setForm({
      customer_name: customer.customer_name,
      farm_name: customer.farm_name ?? "",
      phone_number: customer.phone_number ?? "",
      address: customer.address ?? "",
      city: customer.city ?? "",
      province: customer.province ?? "",
      postal_code: customer.postal_code ?? "",
      tsa_number: customer.tsa_number ?? "",
    });
    setNameError(null);
    setFormError(null);
    setEditingId(customer.id);
    setFormMode("edit");
    setSuccessMsg(null);
  };

  const cancelForm = () => {
    setFormMode(null);
    setEditingId(null);
    setForm(emptyForm());
    setNameError(null);
    setFormError(null);
  };

  const handleSave = async () => {
    if (isSaving) return;

    setNameError(null);
    setFormError(null);

    if (!form.customer_name.trim()) {
      setNameError("Customer name is required");
      return;
    }

    setIsSaving(true);
    try {
      if (formMode === "add") {
        await insertCustomer({
          customer_name: form.customer_name,
          farm_name: form.farm_name || undefined,
          phone_number: form.phone_number || undefined,
          address: form.address || undefined,
          city: form.city || undefined,
          province: form.province || undefined,
          postal_code: form.postal_code || undefined,
          tsa_number: form.tsa_number || undefined,
        });
        setSuccessMsg(`Customer "${form.customer_name.trim()}" added.`);
      } else if (formMode === "edit" && editingId) {
        await updateCustomer(editingId, {
          customer_name: form.customer_name,
          farm_name: form.farm_name || undefined,
          phone_number: form.phone_number || undefined,
          address: form.address || undefined,
          city: form.city || undefined,
          province: form.province || undefined,
          postal_code: form.postal_code || undefined,
          tsa_number: form.tsa_number || undefined,
        });
        setSuccessMsg(`Customer "${form.customer_name.trim()}" updated.`);
      }
      cancelForm();
      await loadCustomers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save customer";
      if (msg.toLowerCase().includes("already exists")) {
        setNameError(msg);
      } else {
        setFormError(msg);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (customer: CustomerOption) => {
    if (
      !window.confirm(
        `Delete "${customer.customer_name}"? This cannot be undone.`
      )
    ) {
      return;
    }
    setSuccessMsg(null);
    try {
      await deleteCustomer(customer.id);
      setSuccessMsg(`Customer "${customer.customer_name}" deleted.`);
      setCustomers((prev) => prev.filter((c) => c.id !== customer.id));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to delete customer");
    }
  };

  const handleFieldChange = (field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (field === "customer_name" && nameError) setNameError(null);
    setFormError(null);
  };

  return (
    <div>
      <h1 className={styles.heading}>Customers</h1>

      {loadError && <div className={styles.error}>{loadError}</div>}
      {successMsg && <div className={styles.success}>{successMsg}</div>}

      {/* ---- Add / Edit Form ---- */}
      {formMode && (
        <div className={styles.formPanel}>
          <div className={styles.formTitle}>
            {formMode === "add" ? "Add Customer" : "Edit Customer"}
          </div>
          {formError && <div className={styles.error}>{formError}</div>}
          <div className={styles.formGrid}>
            <div className={styles.fieldFull}>
              <label className={styles.label}>Customer Name *</label>
              <input
                className={`${styles.input} ${nameError ? styles.inputError : ""}`}
                type="text"
                value={form.customer_name}
                onChange={(e) => handleFieldChange("customer_name", e.target.value)}
                placeholder="Customer name"
                autoFocus
              />
              {nameError && (
                <span className={styles.fieldErrorText}>{nameError}</span>
              )}
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Farm Name</label>
              <input
                className={styles.input}
                type="text"
                value={form.farm_name}
                onChange={(e) => handleFieldChange("farm_name", e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>TSA Number</label>
              <input
                className={styles.input}
                type="text"
                value={form.tsa_number}
                onChange={(e) => handleFieldChange("tsa_number", e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Phone</label>
              <input
                className={styles.input}
                type="text"
                value={form.phone_number}
                onChange={(e) => handleFieldChange("phone_number", e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Address</label>
              <input
                className={styles.input}
                type="text"
                value={form.address}
                onChange={(e) => handleFieldChange("address", e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>City</label>
              <input
                className={styles.input}
                type="text"
                value={form.city}
                onChange={(e) => handleFieldChange("city", e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Province</label>
              <input
                className={styles.input}
                type="text"
                value={form.province}
                onChange={(e) => handleFieldChange("province", e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Postal Code</label>
              <input
                className={styles.input}
                type="text"
                value={form.postal_code}
                onChange={(e) => handleFieldChange("postal_code", e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>
          <div className={styles.formActions}>
            <button
              className={styles.saveBtn}
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? "Saving…" : formMode === "add" ? "Add Customer" : "Save Changes"}
            </button>
            <button className={styles.cancelBtn} onClick={cancelForm} disabled={isSaving}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ---- Toolbar ---- */}
      <div className={styles.toolbar}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search customers…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {!formMode && (
          <button className={styles.addBtn} onClick={openAdd}>
            + Add Customer
          </button>
        )}
      </div>

      {/* ---- Table ---- */}
      {loading ? (
        <div className={styles.status}>Loading customers…</div>
      ) : customers.length === 0 ? (
        <div className={styles.status}>No customers yet. Add your first customer above.</div>
      ) : filtered.length === 0 ? (
        <div className={styles.status}>No customers match your search.</div>
      ) : (
        <div className={styles.wrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Farm</th>
                <th>TSA #</th>
                <th>Phone</th>
                <th>City</th>
                <th>Province</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td>{c.customer_name}</td>
                  <td>{c.farm_name || "—"}</td>
                  <td>{c.tsa_number || "—"}</td>
                  <td>{c.phone_number || "—"}</td>
                  <td>{c.city || "—"}</td>
                  <td>{c.province || "—"}</td>
                  <td className={styles.actionCell}>
                    <button
                      className={styles.editBtn}
                      onClick={() => openEdit(c)}
                    >
                      Edit
                    </button>
                    <button
                      className={styles.deleteBtn}
                      onClick={() => handleDelete(c)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
