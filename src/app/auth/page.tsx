"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import styles from "./auth.module.css";

type Mode = "sign_in" | "sign_up";

function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") || "/";
  const [mode, setMode] = useState<Mode>("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    const supabase = getSupabaseBrowserClient();

    if (mode === "sign_in") {
      const { error: err } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      router.push(redirectTo);
      router.refresh();
    } else {
      const { error: err } = await supabase.auth.signUp({
        email,
        password,
      });
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      setSuccess("Check your email for a confirmation link.");
      setLoading(false);
    }
  };

  return (
    <div className={styles.card}>
      <h1 className={styles.logo}>
        <Image
          src="/assets/logos/logo-main.svg"
          alt="Stevens Seeds Inventory Management"
          width={767}
          height={216}
          priority
          unoptimized
          style={{ width: "100%", maxWidth: "300px", height: "auto" }}
        />
      </h1>

      <div className={styles.toggle}>
        <button
          className={`${styles.toggleBtn} ${mode === "sign_in" ? styles.toggleActive : ""}`}
          onClick={() => { setMode("sign_in"); setError(""); setSuccess(""); }}
          type="button"
        >
          Sign In
        </button>
        <button
          className={`${styles.toggleBtn} ${mode === "sign_up" ? styles.toggleActive : ""}`}
          onClick={() => { setMode("sign_up"); setError(""); setSuccess(""); }}
          type="button"
        >
          Sign Up
        </button>
      </div>

      <form onSubmit={handleSubmit} className={styles.form}>
        <label className={styles.label}>
          Email
          <input
            className={styles.input}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>

        <label className={styles.label}>
          Password
          <input
            className={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={mode === "sign_in" ? "current-password" : "new-password"}
          />
        </label>

        {error && <p className={styles.error}>{error}</p>}
        {success && <p className={styles.success}>{success}</p>}

        <button
          className={styles.submit}
          type="submit"
          disabled={loading}
        >
          {loading
            ? "Loading..."
            : mode === "sign_in"
              ? "Sign In"
              : "Create Account"}
        </button>
      </form>
    </div>
  );
}

export default function AuthPage() {
  return (
    <div className={styles.wrapper}>
      <Suspense>
        <AuthForm />
      </Suspense>
    </div>
  );
}
