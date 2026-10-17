import { useState } from "react";
import type { ComponentKindInfo } from "@dt-platform/renderer";

interface AddComponentMenuProps {
  /** The kinds the entity can gain, as `addableKinds` returns them. */
  kinds: readonly ComponentKindInfo[];
  onAdd: (kind: string) => void;
}

/**
 * The Inspector's "Add Component" control: a button that opens a short list
 * of the kinds the entity can gain. The open state lives here, and the
 * Inspector keys the menu by the selected entity, so selecting another entity
 * closes it.
 */
export function AddComponentMenu({ kinds, onAdd }: AddComponentMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="px-4 py-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="w-full px-3 py-1.5 text-xs font-semibold rounded bg-surface-raised border border-border text-text-muted hover:text-text-primary"
      >
        Add Component
      </button>
      {open && (
        <ul className="mt-1 rounded border border-border">
          {kinds.map((info) => (
            <li key={info.kind}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onAdd(info.kind);
                }}
                className="w-full px-3 py-1.5 text-left text-xs text-text-primary hover:bg-surface-raised"
              >
                {info.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
