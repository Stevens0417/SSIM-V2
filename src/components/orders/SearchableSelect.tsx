"use client";

import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import styles from "./SearchableSelect.module.css";

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

interface DropdownPos {
  top: number;
  left: number;
  width: number;
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [pos, setPos] = useState<DropdownPos>({ top: 0, left: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedLabel =
    options.find((o) => o.value === value)?.label ?? "";

  const filtered = query
    ? options.filter((o) =>
        o.label.toLowerCase().includes(query.toLowerCase())
      )
    : options;

  // Compute dropdown position from input bounding rect
  const updatePos = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + window.scrollY + 2,
      left: rect.left + window.scrollX,
      width: rect.width,
    });
  }, []);

  // Position on open and on scroll/resize
  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open, updatePos]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        listRef.current &&
        !listRef.current.contains(target)
      ) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlightIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx, open]);

  const select = useCallback(
    (val: string) => {
      onChange(val);
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
    },
    [onChange]
  );

  const handleFocus = () => {
    if (disabled) return;
    setOpen(true);
    setQuery("");
    setHighlightIdx(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightIdx((prev) => Math.min(prev + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightIdx((prev) => Math.max(prev - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (filtered[highlightIdx]) {
          select(filtered[highlightIdx].value);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        setQuery("");
        inputRef.current?.blur();
        break;
    }
  };

  const displayValue = open ? query : selectedLabel;

  const dropdown =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            className={styles.dropdown}
            ref={listRef}
            style={{
              position: "absolute",
              top: pos.top,
              left: pos.left,
              width: pos.width,
            }}
          >
            {filtered.length === 0 ? (
              <div className={styles.noResults}>No matches</div>
            ) : (
              filtered.map((opt, idx) => (
                <div
                  key={opt.value}
                  className={
                    idx === highlightIdx
                      ? `${styles.option} ${styles.optionHighlighted}`
                      : styles.option
                  }
                  onMouseEnter={() => setHighlightIdx(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(opt.value);
                  }}
                >
                  {opt.label}
                </div>
              ))
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <div className={styles.container} ref={containerRef}>
      <input
        ref={inputRef}
        className={styles.input}
        type="text"
        value={displayValue}
        placeholder={placeholder}
        disabled={disabled}
        title={selectedLabel || undefined}
        onFocus={handleFocus}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlightIdx(0);
        }}
        onKeyDown={handleKeyDown}
      />
      <span className={styles.chevron}>▼</span>
      {dropdown}
    </div>
  );
}
