// AYA GROUP POS hotfix: validasi form Master Barang dan posisi dialog.
const dialog = document.querySelector('#appDialog');
const dialogBody = document.querySelector('#dialogBody');

function resetDialogScroll() {
  if (!dialog?.open || !dialogBody) return;
  dialogBody.scrollTop = 0;
  const form = dialogBody.querySelector('form');
  form?.scrollTo?.({ top: 0, behavior: 'instant' });
}

function showValidationMessage(form) {
  const invalid = form?.querySelector(':invalid');
  if (!invalid) return false;

  invalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
  invalid.focus({ preventScroll: true });

  const label = invalid.closest('label')?.childNodes?.[0]?.textContent?.trim() || 'Kolom wajib';
  alert(`${label} belum diisi atau nilainya belum benar.`);
  return true;
}

const observer = new MutationObserver(() => {
  if (dialog?.open) requestAnimationFrame(resetDialogScroll);
});

if (dialog) {
  observer.observe(dialog, {
    attributes: true,
    attributeFilter: ['open'],
    childList: true,
    subtree: true
  });

  dialog.addEventListener('close', () => {
    if (dialogBody) dialogBody.scrollTop = 0;
  });
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('#saveProduct');
  if (!button) return;

  const form = document.querySelector('#productForm');
  if (!form) return;

  if (!form.checkValidity()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    showValidationMessage(form);
  }
}, true);

window.addEventListener('unhandledrejection', (event) => {
  const message = String(event.reason?.message || event.reason || '');
  if (/permission_denied|permission denied|PERMISSION_DENIED/i.test(message)) {
    alert(
      'Firebase menolak penyimpanan. Pastikan Anda login sebagai Owner dan Realtime Database Rules sudah dipublikasikan.'
    );
  }
});
