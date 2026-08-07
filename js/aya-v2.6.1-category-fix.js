import { getOnce, setData, saveProduct } from './store.js';

const dialog = document.querySelector('#appDialog');
const dialogTitle = document.querySelector('#dialogTitle');

function text(value) {
  return String(value ?? '').trim();
}

function normalized(value) {
  return text(value).toLocaleLowerCase('id-ID');
}

function slug(value, fallback = 'kategori') {
  return text(value)
    .toLocaleLowerCase('id-ID')
    .normalize('NFKD')
    .replace(/[^\w]+/g, '-')
    .replace(/^-+|-+$/g, '') || `${fallback}-${Date.now()}`;
}

function values(value) {
  if (!value || typeof value !== 'object') return [];

  if (Array.isArray(value)) {
    return value
      .map((row, index) => {
        if (!row) return null;
        return row && typeof row === 'object'
          ? { ...row, id: String(row.id ?? index) }
          : { id: String(index), name: String(row) };
      })
      .filter(Boolean);
  }

  return Object.entries(value).map(([id, row]) => (
    row && typeof row === 'object'
      ? { ...row, id: String(row.id || id) }
      : { id: String(id), name: String(row) }
  ));
}

function notify(message, type = 'success') {
  const host = document.querySelector('#alertHost');

  if (!host) {
    alert(message);
    return;
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  host.append(toast);
  setTimeout(() => toast.remove(), 5200);
}

function assertWrite(result, label) {
  if (result?.error) {
    throw new Error(
      `${label} belum tersimpan ke Firebase: ${result.error.message || result.error}`
    );
  }
  return result;
}

async function loadCategoryData() {
  const [categoriesRaw, productsRaw] = await Promise.all([
    getOnce('productCategories'),
    getOnce('products')
  ]);

  return {
    categories: values(categoriesRaw),
    products: values(productsRaw).filter(product => product.active !== false)
  };
}

function findCategory(categories, id, name) {
  return categories.find(category => String(category.id) === String(id))
    || categories.find(category => normalized(category.name) === normalized(name))
    || {
      id: id || slug(name),
      name,
      active: true,
      synthetic: true
    };
}

async function saveCategoryRecord(record, name, active = true) {
  const id = String(record?.id || slug(name));
  const result = await setData(`productCategories/${id}`, {
    id,
    name: text(name),
    active,
    updatedAt: Date.now()
  });
  assertWrite(result, 'Kategori');
  return { id, name: text(name), active };
}

async function saveChangedProduct(product, category) {
  const result = await saveProduct({
    ...product,
    category,
    updatedAt: Date.now()
  });
  assertWrite(result, `Barang ${product.name || product.id}`);
}

function refreshCategoryManager() {
  if (dialog?.open) dialog.close();

  setTimeout(() => {
    const button = document.querySelector('#manageProductCategories');
    if (button) button.click();
  }, 100);
}

async function editCategory(id, oldName, button) {
  const nextName = text(prompt('Ubah nama kategori:', oldName));
  if (!nextName || normalized(nextName) === normalized(oldName)) return;

  button.disabled = true;

  try {
    const { categories, products } = await loadCategoryData();

    const duplicateSaved = categories.some(category =>
      category.active !== false
      && String(category.id) !== String(id)
      && normalized(category.name) === normalized(nextName)
    );

    const duplicateFromProduct = products.some(product =>
      normalized(product.category) === normalized(nextName)
      && normalized(product.category) !== normalized(oldName)
    );

    if (duplicateSaved || duplicateFromProduct) {
      notify('Nama kategori tersebut sudah digunakan.', 'error');
      return;
    }

    const record = findCategory(categories, id, oldName);
    const affected = products.filter(product =>
      normalized(product.category) === normalized(oldName)
    );

    if (
      affected.length
      && !confirm(
        `Ubah kategori “${oldName}” menjadi “${nextName}” pada ${affected.length} barang?`
      )
    ) {
      return;
    }

    for (const product of affected) {
      await saveChangedProduct(product, nextName);
    }

    await saveCategoryRecord(record, nextName, true);

    notify(
      affected.length
        ? `Kategori diubah. ${affected.length} barang ikut diperbarui.`
        : `Kategori diubah menjadi “${nextName}”.`
    );

    refreshCategoryManager();
  } catch (error) {
    console.error('Edit kategori:', error);
    notify(error.message || 'Kategori gagal diedit.', 'error');
  } finally {
    button.disabled = false;
  }
}

async function deleteCategory(id, oldName, button) {
  button.disabled = true;

  try {
    const { categories, products } = await loadCategoryData();
    const record = findCategory(categories, id, oldName);
    const affected = products.filter(product =>
      normalized(product.category) === normalized(oldName)
    );

    let replacementName = '';

    if (affected.length) {
      replacementName = text(
        prompt(
          `Kategori “${oldName}” masih dipakai oleh ${affected.length} barang.\n`
          + 'Masukkan kategori pengganti sebelum kategori ini dihapus:',
          'Lainnya'
        )
      );

      if (!replacementName) return;

      if (normalized(replacementName) === normalized(oldName)) {
        notify('Kategori pengganti harus berbeda dari kategori yang dihapus.', 'error');
        return;
      }

      const confirmation = confirm(
        `Pindahkan ${affected.length} barang dari “${oldName}” ke `
        + `“${replacementName}”, lalu hapus kategori lama?`
      );

      if (!confirmation) return;

      const replacementRecord = categories.find(category =>
        normalized(category.name) === normalized(replacementName)
      ) || {
        id: slug(replacementName),
        name: replacementName
      };

      await saveCategoryRecord(replacementRecord, replacementName, true);

      for (const product of affected) {
        await saveChangedProduct(product, replacementName);
      }
    } else if (!confirm(`Hapus kategori “${oldName}”?`)) {
      return;
    }

    await saveCategoryRecord(record, oldName, false);

    notify(
      affected.length
        ? `Kategori dihapus dan ${affected.length} barang dipindahkan ke “${replacementName}”.`
        : `Kategori “${oldName}” dihapus.`
    );

    refreshCategoryManager();
  } catch (error) {
    console.error('Hapus kategori:', error);
    notify(error.message || 'Kategori gagal dihapus.', 'error');
  } finally {
    button.disabled = false;
  }
}

/*
 * Handler capture ini sengaja dijalankan sebelum handler v2.6.
 * Versi lama gagal pada kategori sintetis karena hanya mencari categoryRecords.
 */
document.addEventListener('click', event => {
  if (text(dialogTitle?.textContent) !== 'Kelola Kategori') return;

  const editButton = event.target.closest('[data-category-edit]');
  const deleteButton = event.target.closest('[data-category-delete]');
  const button = editButton || deleteButton;

  if (!button) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const row = button.closest('.taxonomy-row');
  const name = text(row?.querySelector('strong')?.textContent);
  const id = editButton
    ? editButton.dataset.categoryEdit
    : deleteButton.dataset.categoryDelete;

  if (!name) {
    notify('Nama kategori tidak ditemukan.', 'error');
    return;
  }

  if (editButton) {
    editCategory(id, name, button);
  } else {
    deleteCategory(id, name, button);
  }
}, true);
