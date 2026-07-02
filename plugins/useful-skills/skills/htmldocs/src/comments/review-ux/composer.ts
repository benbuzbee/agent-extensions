// The <dialog> composer for entering comment body text. Extracted from ui.ts.
// The composer is a `<dialog class="htmldocs-cmt-composer">` so the prefix
// check in selectionInDocBody covers it.

import type { Anchor } from './types';

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
  document.body.appendChild(dialog);
  return dialog;
}

export interface ComposerDeps {
  saveAnchoredComment(anchor: Anchor, body: string): Promise<unknown>;
}

/**
 * Wire up the composer form-submit/cancel/error handling. Returns detachers
 * for cleanup.
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

  const onSubmit = (e: Event): void => {
    e.preventDefault();
    if (saveInFlight) return;
    const body = textarea.value.trim();
    const anchor = getPendingAnchor();
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
  };
  composer.addEventListener('submit', onSubmit);

  cancelBtn.addEventListener('click', () => {
    clearPendingAnchor();
    composer.close();
  });

  const onClose = (): void => {
    clearPendingAnchor();
  };
  composer.addEventListener('close', onClose);

  return { detachers: [] };
}
