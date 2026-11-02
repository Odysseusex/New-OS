"use client";

import { useSubmitShortcutLabel } from "@/lib/keyboard";

// «⌘↵» / «Ctrl+↵» on a window's main button: the key that presses it (Modal).
export function SubmitShortcutHint() {
  const label = useSubmitShortcutLabel();
  if (!label) return null;
  return <span className="ml-2 hidden text-xs font-normal opacity-70 sm:inline">{label}</span>;
}
