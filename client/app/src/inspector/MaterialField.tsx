import { hexToRgb, rgbToHex, type MaterialJson } from "@dt-platform/renderer";
import { useComponentField } from "./useComponentField";
import type { FieldRendererProps } from "./FieldRenderer";

export function MaterialField({ engine, handle }: FieldRendererProps) {
  const { value, setValue, error } = useComponentField<MaterialJson>(
    engine,
    handle,
    "Material",
  );
  if (!value) return null;
  // The picker works in 8-bit sRGB hex, the way the colour is authored. The
  // engine keeps the exact floats until the user picks something new.
  const hex = rgbToHex(value.base_color);

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-text-primary w-20 shrink-0">
          Base Color
        </span>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={hex}
            onChange={(e) => {
              const rgb = hexToRgb(e.target.value);
              if (rgb) setValue({ base_color: rgb });
            }}
            className="h-6 w-10 cursor-pointer bg-surface-raised border border-border rounded"
          />
          <span className="text-xs text-text-muted font-mono">{hex}</span>
        </div>
      </div>
      {error && <p className="text-text-error text-xs mt-1">{error}</p>}
    </div>
  );
}
