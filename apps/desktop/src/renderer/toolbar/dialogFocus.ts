import { type RefObject, useEffect } from 'react';

/**
 * A panel that calls itself modal takes the keyboard when it opens and hands it back when it closes: otherwise focus
 * stays on the button outside it — the one place assistive technology has just been told is out of reach — and the
 * panel's checkboxes and buttons are a blind Tab away. The panel itself gets the focus (`tabIndex={-1}`), so its
 * name is read first and Tab goes on to its first control — or `first`, for a menu or a form, whose first item or
 * field is what the user came for.
 */
export const useDialogFocus = (
  open: boolean,
  panel: RefObject<HTMLElement | null>,
  trigger: RefObject<HTMLElement | null>,
  first?: RefObject<HTMLElement | null>,
): void => {
  useEffect(() => {
    if (!open) return;
    (first?.current ?? panel.current)?.focus();
    return () => {
      // Back to the button only when the focus went down with the panel: a click elsewhere keeps where it went.
      const active = document.activeElement;
      if (!active || active === document.body || panel.current?.contains(active)) {
        trigger.current?.focus();
      }
    };
  }, [open, panel, trigger, first]);
};
