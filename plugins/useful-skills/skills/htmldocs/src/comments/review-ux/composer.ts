// The <dialog> composer for entering comment body text.
// The composer is a `<dialog class="htmldocs-cmt-composer">` so the prefix
// check in selectionInDocBody covers it.

import type { Anchor } from './types';

// Construct the composer `<dialog>` and return it detached. The caller
// (mount's attachUI) owns placement — it appends the returned node to the
// document and removes it on unmount.
export function buildComposer(): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  dialog.className = 'htmldocs-cmt-composer';
  dialog.innerHTML =
    '<form method="dialog">' +
    '<label><textarea class="htmldocs-cmt-composer-body" required ' +
    'placeholder="Leave a comment…" aria-label="Comment body"></textarea></label>' +
    '<div class="htmldocs-cmt-composer-error" role="alert"></div>' +
    '<div class="htmldocs-cmt-composer-actions">' +
    '<button type="button" class="htmldocs-cmt-composer-cancel">Cancel</button>' +
    '<button type="submit" class="htmldocs-cmt-composer-submit">Comment</button>' +
    '</div>' +
    '</form>';
  return dialog;
}

export interface ComposerDeps {
  saveAnchoredComment(anchor: Anchor, body: string): Promise<unknown>;
}

/**
 * Attach the composer's behavior and return detachers for it. Concretely this
 * wires: the form-submit handler (trim the body, guard against a re-entrant
 * submit while a save is in flight, call saveAnchoredComment, close on success
 * or populate the error slot on failure), the cancel button, and a close
 * handler that drops the pending anchor. The returned detachers remove exactly
 * those listeners so mount's unmount can tear the composer down without leaks.
 */
export function wireComposer(
  composer: HTMLDialogElement,
  deps: ComposerDeps,
  getPendingAnchor: () => Anchor | null,
  clearPendingAnchor: () => void,
): { detachers: Array<() => void> } {
  const textarea = composer.querySelector('textarea') as HTMLTextAreaElement;
  const errorSlot = composer.querySelector('.htmldocs-cmt-composer-error') as HTMLElement;
  const cancelBtn = composer.querySelector('.htmldocs-cmt-composer-cancel') as HTMLButtonElement;
  const submitBtn = composer.querySelector('.htmldocs-cmt-composer-submit') as HTMLButtonElement;

  let saveInFlight = false;

  function setSaveInFlight(busy: boolean): void {
    saveInFlight = busy;
    submitBtn.disabled = busy;
  }

  function onSubmit(e: Event): void {
    e.preventDefault();
    if (saveInFlight) return;
    const body = textarea.value.trim();
    const anchor = getPendingAnchor();
    // Nothing to persist: an empty body (the `required` field normally blocks
    // this) or a pending anchor that went null because the selection was lost.
    // Close silently — there is no comment to save and no error to report, and
    // opening the composer already cleared any prior error text.
    if (!body || !anchor) { composer.close(); return; }
    errorSlot.textContent = '';
    setSaveInFlight(true);
    void deps.saveAnchoredComment(anchor, body)
      .then(() => {
        clearPendingAnchor();
        setSaveInFlight(false);
        composer.close();
      })
      .catch((err: unknown) => {
        setSaveInFlight(false);
        const name = err instanceof DOMException ? err.name : '';
        if (name === 'AbortError' || name === 'NotAllowedError') {
          errorSlot.textContent =
            'Pick a folder to save your comments, then submit again.';
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        errorSlot.textContent = msg;
      });
  }

  function onCancel(): void {
    clearPendingAnchor();
    composer.close();
  }

  function onClose(): void {
    clearPendingAnchor();
  }

  composer.addEventListener('submit', onSubmit);
  cancelBtn.addEventListener('click', onCancel);
  composer.addEventListener('close', onClose);

  return {
    detachers: [
      () => composer.removeEventListener('submit', onSubmit),
      () => cancelBtn.removeEventListener('click', onCancel),
      () => composer.removeEventListener('close', onClose),
    ],
  };
}
