// «Обновить» reloads the whole page: fresh data on every screen and, after a
// deploy, the new version of the app itself. A screen holding unsaved work (the
// till's open check) registers a guard that names what would be lost, and the
// reload asks first.
let guard: (() => string | null) | null = null;

export function setReloadGuard(next: (() => string | null) | null) {
  guard = next;
}

export function reloadPage() {
  const warning = guard?.();
  if (warning && !window.confirm(warning)) return;
  window.location.reload();
}
