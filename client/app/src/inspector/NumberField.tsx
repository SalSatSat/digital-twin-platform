import { useEffect, useRef, useState } from "react";

interface NumberFieldProps {
  value: number;
  onChange: (next: number) => void;
  className?: string;
}

/**
 * Rounds to 6 decimal places and drops trailing zeros — enough
 * precision for any value this Inspector edits, while hiding the
 * f32->f64 round-trip noise (e.g. 0.10000000149011612) that the raw
 * stored value can carry. Display-only: the underlying value written
 * to the ECS is never rounded, only what's shown when not focused.
 */
function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return String(Math.round(n * 1e6) / 1e6);
}

/**
 * A numeric input that holds its own local text buffer while focused,
 * so an in-progress, not-yet-valid string ("-", "1.", "1e") isn't
 * clobbered by the controlled value re-rendering mid-keystroke — the
 * bug a plain `<input type="number" value={n} onChange={...
 * Number(e.target.value)}>` has with negative numbers specifically:
 * Number("-") is NaN, which snaps the field back before a minus sign
 * can be followed by digits.
 *
 * Commits to onChange on every keystroke where the buffer currently
 * parses to a finite number, so debounced writes upstream still feel
 * live. Only re-syncs its buffer FROM the external value when not
 * focused — while focused, the user's own typing is the source of
 * truth for what's displayed, even if it's momentarily invalid.
 */
export function NumberField({ value, onChange, className }: NumberFieldProps) {
  const [text, setText] = useState(() => formatNumber(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) {
      setText(formatNumber(value));
    }
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        setText(formatNumber(value));
      }}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const parsed = Number(next);
        if (next.trim() !== "" && Number.isFinite(parsed)) {
          onChange(parsed);
        }
      }}
      className={className}
    />
  );
}
