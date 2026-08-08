import { auth, db } from './firebase-config.js';
import {
  signInWithEmailAndPassword
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  ref, get, update
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

const ROOT = 'ayaGroupV2';
const REQUIRED_BRANCH = 'dapur-aya-sembako';
const BATCH_SIZE = 175;

const loginForm = document.querySelector('#loginForm');
const loginState = document.querySelector('#loginState');
const jsonFile = document.querySelector('#jsonFile');
const fileState = document.querySelector('#fileState');
const summary = document.querySelector('#summary');
const existingMode = document.querySelector('#existingMode');
const importButton = document.querySelector('#importButton');
const progress = document.querySelector('#progress');
const importState = document.querySelector('#importState');

let ownerReady = false;
let payload = null;

function setState(element, message, type = '') {
  element.className = type || 'muted';
  element.textContent = message;
}

function metric(label, value) {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function validatePayload(value) {
  if (!value || value.format !== 'AYA_POS_MYSQL_PRODUCT_IMPORT') {
    throw new Error('Format file bukan hasil konversi AYA POS.');
  }
  if (value.branchId !== REQUIRED_BRANCH) {
    throw new Error('File bukan untuk Cabang DAPUR AYA.');
  }
  if (!Array.isArray(value.products) || !value.products.length) {
    throw new Error('Daftar produk kosong.');
  }
  return value;
}

function refreshButton() {
  importButton.disabled = !(ownerReady && payload);
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(loginForm);

  try {
    setState(loginState, 'Memeriksa akun…');
    const credential = await signInWithEmailAndPassword(
      auth,
      String(form.get('email') || '').trim(),
      String(form.get('password') || '')
    );

    const profileSnapshot = await get(
      ref(db, `${ROOT}/users/${credential.user.uid}`)
    );
    const profile = profileSnapshot.val();

    if (
      !profile
      || profile.active !== true
      || String(profile.role || '').toLowerCase() !== 'owner'
    ) {
      ownerReady = false;
      throw new Error('Akun ini bukan Owner aktif.');
    }

    ownerReady = true;
    setState(
      loginState,
      `Login Owner berhasil: ${profile.name || credential.user.email}`,
      'success'
    );
  } catch (error) {
    ownerReady = false;
    setState(loginState, error.message || 'Login gagal.', 'error');
  }

  refreshButton();
});

jsonFile.addEventListener('change', async () => {
  payload = null;
  summary.innerHTML = '';

  const file = jsonFile.files?.[0];
  if (!file) {
    setState(fileState, 'Belum ada file dipilih.');
    refreshButton();
    return;
  }

  try {
    const parsed = JSON.parse(await file.text());
    payload = validatePayload(parsed);
    const info = payload.summary || {};

    summary.innerHTML = [
      metric('Barang siap', Number(info.productsReady || payload.products.length).toLocaleString('id-ID')),
      metric('Barang aktif', Number(info.activeProducts || 0).toLocaleString('id-ID')),
      metric('Nonaktif', Number(info.inactiveProducts || 0).toLocaleString('id-ID')),
      metric('Perlu diperiksa', Number(info.reviewRows || 0).toLocaleString('id-ID')),
      metric('Kategori', Number(info.categories || payload.categories?.length || 0).toLocaleString('id-ID')),
      metric('Cabang tujuan', 'DAPUR AYA')
    ].join('');

    setState(
      fileState,
      `File valid: ${file.name}. Tidak ada data yang dihapus oleh alat ini.`,
      'success'
    );
  } catch (error) {
    payload = null;
    setState(fileState, error.message || 'File tidak dapat dibaca.', 'error');
  }

  refreshButton();
});

importButton.addEventListener('click', async () => {
  if (!ownerReady || !payload) return;

  const overwrite = existingMode.value === 'overwrite';

  if (!confirm(
    `Import ${payload.products.length.toLocaleString('id-ID')} barang ke DAPUR AYA?\n`
    + (overwrite
      ? 'Barang dengan ID sama akan diperbarui.'
      : 'Barang dengan ID sama akan dilewati.')
  )) return;

  importButton.disabled = true;
  progress.hidden = false;
  progress.value = 0;
  setState(importState, 'Membaca data Firebase yang sudah ada…');

  try {
    const existingSnapshot = await get(ref(db, `${ROOT}/products`));
    const existingProducts = existingSnapshot.val() || {};

    const productsToWrite = payload.products.filter(product =>
      overwrite || !existingProducts[product.id]
    );
    const skipped = payload.products.length - productsToWrite.length;

    const taxonomyUpdates = {};
    for (const category of payload.categories || []) {
      taxonomyUpdates[`productCategories/${category.id}`] = {
        ...category,
        updatedAt: Date.now()
      };
    }
    for (const unit of payload.units || []) {
      taxonomyUpdates[`productUnits/${unit.id}`] = {
        ...unit,
        updatedAt: Date.now()
      };
    }

    if (Object.keys(taxonomyUpdates).length) {
      await update(ref(db, ROOT), taxonomyUpdates);
    }

    let completed = 0;
    for (let index = 0; index < productsToWrite.length; index += BATCH_SIZE) {
      const batch = productsToWrite.slice(index, index + BATCH_SIZE);
      const writes = {};

      for (const product of batch) {
        const now = Date.now();
        writes[`products/${product.id}`] = {
          ...product,
          updatedAt: now
        };
        writes[`stockByBranch/${REQUIRED_BRANCH}/${product.id}`] =
          Number(product.stock || 0);
      }

      await update(ref(db, ROOT), writes);
      completed += batch.length;
      progress.value = productsToWrite.length
        ? Math.round(completed / productsToWrite.length * 100)
        : 100;
      setState(
        importState,
        `Memproses ${completed.toLocaleString('id-ID')} dari `
        + `${productsToWrite.length.toLocaleString('id-ID')} barang…`
      );
    }

    progress.value = 100;
    setState(
      importState,
      `Import selesai. ${productsToWrite.length.toLocaleString('id-ID')} barang disimpan`
      + (skipped
        ? ` dan ${skipped.toLocaleString('id-ID')} barang lama dilewati.`
        : '.'),
      'success'
    );
  } catch (error) {
    console.error(error);
    setState(
      importState,
      error.message || 'Import gagal. Tidak ada proses hapus otomatis.',
      'error'
    );
  } finally {
    refreshButton();
  }
});
