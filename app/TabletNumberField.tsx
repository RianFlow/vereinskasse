"use client";

import { useEffect, useRef, useState } from "react";

type TabletNumberFieldProps = {
  value: number | null;
  onChange: (value: number | null) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  unit?: string;
  allowEmpty?: boolean;
  compact?: boolean;
};

const decimalsFor = (step: number) => Math.max(0, (String(step).split(".")[1] || "").length);

export function TabletNumberField({ value, onChange, label, min = 0, max = Number.MAX_SAFE_INTEGER, step = 1, precision, unit, allowEmpty = false, compact = false }: TabletNumberFieldProps) {
  const decimals = precision ?? decimalsFor(step);
  const format = (number: number | null) => number === null ? "" : number.toFixed(decimals).replace(".", ",");
  const [text, setText] = useState(format(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(format(value));
  }, [value, decimals]); // eslint-disable-line react-hooks/exhaustive-deps

  const clamp = (number: number) => {
    const factor = 10 ** decimals;
    return Math.min(max, Math.max(min, Math.round(number * factor) / factor));
  };
  const commit = (raw: string) => {
    const number = Number(raw.replace(",", "."));
    if (!raw.trim() || !Number.isFinite(number)) {
      if (allowEmpty) {
        setText("");
        onChange(null);
      } else {
        const fallback = value ?? min;
        setText(format(fallback));
        onChange(fallback);
      }
      return;
    }
    const next = clamp(number);
    setText(format(next));
    onChange(next);
  };
  const adjust = (direction: -1 | 1) => {
    const base = value ?? min;
    const next = clamp(base + direction * step);
    setText(format(next));
    onChange(next);
  };
  const pattern = decimals > 0 ? /^\d*(?:[,.]\d*)?$/ : /^\d*$/;

  return <div className={`tablet-number-field${compact ? " compact" : ""}`}>
    <button type="button" aria-label={`${label} verringern`} onClick={() => adjust(-1)} disabled={value !== null && value <= min}>−</button>
    <div>
      <input
        aria-label={label}
        inputMode={decimals > 0 ? "decimal" : "numeric"}
        value={text}
        onFocus={event => { focused.current = true; event.currentTarget.select(); }}
        onChange={event => {
          const raw = event.target.value;
          if (!pattern.test(raw)) return;
          setText(raw);
          const number = Number(raw.replace(",", "."));
          if (raw && Number.isFinite(number)) onChange(clamp(number));
          else if (!raw && allowEmpty) onChange(null);
        }}
        onBlur={event => { focused.current = false; commit(event.currentTarget.value); }}
      />
      {unit && <span>{unit}</span>}
    </div>
    <button type="button" aria-label={`${label} erhöhen`} onClick={() => adjust(1)} disabled={value !== null && value >= max}>+</button>
  </div>;
}
