// Input types where letters are typed text, so keyboard shortcuts must stay out
// of the way. Checkboxes, buttons, ranges etc. are deliberately not listed:
// they keep focus after a click and must not silence the shortcuts.
const TEXT_INPUT_TYPES = new Set([
  "text",
  "number",
  "search",
  "email",
  "url",
  "tel",
  "password",
]);

/**
 * True when a key event came from a text-entry element (a text-like
 * input, textarea, select, or contenteditable). Global letter shortcuts
 * should ignore such events.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  return (
    target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type)
  );
}
