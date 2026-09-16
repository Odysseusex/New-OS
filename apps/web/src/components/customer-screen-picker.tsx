"use client";

import { Monitor } from "lucide-react";
import { Modal } from "@/components/modal";
import { openCustomerDisplayOnScreen, type ScreenPlacement } from "@/lib/customer-display";

// Shown when there is more than one screen and none of them matches what was
// remembered last time — the first time «Экран покупателя» is used on this
// machine, or after the cashier taps «Сменить экран».
//
// It exists because the earlier version of openCustomerDisplay() trusted
// Windows' own idea of which screen is primary, and Windows can change that
// on its own — a monitor reconnect, a driver update, a stray tap in its own
// display settings — with nothing in this app able to see or prevent it. The
// owner hit exactly this: «Расширить экраны» in Windows started making the
// SECOND physical screen primary instead of the first, and the customer
// window followed it there. Picking here instead, once, fixes it for good:
// the choice is remembered on this machine and used from then on regardless
// of what Windows calls primary.
export function CustomerScreenPickerModal({
  screens,
  hostIndex,
  onClose,
}: {
  screens: ScreenPlacement[];
  // Which entry the till's own window currently sits on, so the picker can
  // warn against tapping that one by mistake — the customer window belongs
  // on the OTHER screen from the one showing this dialog.
  hostIndex: number | null;
  onClose: () => void;
}) {
  return (
    <Modal title="Какой экран — для покупателя?" onClose={onClose} width="max-w-sm">
      <p className="mb-4 text-sm text-muted">
        Нажмите на вариант ниже — окно откроется сразу. Посмотрите на второй, физический монитор:
        если там появилось приветствие «Ar-Amir» — всё готово, можно закрыть это окно. Если оно
        появилось поверх этого же экрана — нажмите на другой вариант.
      </p>
      <div className="space-y-2">
        {screens.map((screen, i) => (
          <button
            key={i}
            type="button"
            onClick={() => {
              openCustomerDisplayOnScreen(screen);
              onClose();
            }}
            className="flex w-full items-center gap-3 rounded-xl border border-border px-4 py-3 text-left transition hover:border-accent hover:bg-surface-muted"
          >
            <Monitor className="h-5 w-5 shrink-0 text-muted" strokeWidth={1.75} />
            <span className="flex-1">
              <span className="block text-base font-medium text-foreground">Экран {i + 1}</span>
              {i === hostIndex && (
                <span className="block text-xs text-muted">Здесь сейчас касса — скорее всего не этот</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
