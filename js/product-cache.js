import {
  getProducts,
  invalidateDataCache
} from './store.js';

const CACHE_LIFETIME = 10 * 60 * 1000;
const DAPUR_BRANCH_ID = 'dapur-aya-sembako';
const SEBLAK_BRANCH_ID = 'aya-seblak-angkringan';

let cachedProducts = null;
let loadedAt = 0;
let pendingRequest = null;

export async function getCachedProducts({ force = false } = {}) {
  const fresh = Array.isArray(cachedProducts)
    && Date.now() - loadedAt < CACHE_LIFETIME;

  if (!force && fresh) return cachedProducts;
  if (!force && pendingRequest) return pendingRequest;

  if (force) {
    invalidateDataCache('products');
    cachedProducts = null;
    loadedAt = 0;
  }

  pendingRequest = getProducts({ force })
    .then(rows => {
      cachedProducts = Array.isArray(rows) ? rows : [];
      loadedAt = Date.now();
      return cachedProducts;
    })
    .finally(() => {
      pendingRequest = null;
    });

  return pendingRequest;
}

export function invalidateProductCache({ includeStore = true } = {}) {
  cachedProducts = null;
  loadedAt = 0;
  pendingRequest = null;

  if (includeStore) invalidateDataCache('products');
}

function productBranchInfo(product) {
  const branchIds = Array.isArray(product?.branchIds)
    ? product.branchIds.map(String).filter(Boolean)
    : [];

  const stockByBranch = product?.stockByBranch
    && typeof product.stockByBranch === 'object'
      ? product.stockByBranch
      : {};

  const legacyOrigin = Boolean(
    String(product?.source || '').startsWith('legacy:')
    || product?._legacyPath
    || product?._legacyStockPath
    || Object.keys(product?._legacyBranchStockPaths || {}).length
  );

  return {
    branchIds,
    stockByBranch,
    stockBranchIds: Object.keys(stockByBranch),
    legacyOrigin
  };
}

export function productBelongsToBranch(product, branchId) {
  if (!product || branchId === 'all') return true;

  const {
    branchIds,
    stockByBranch,
    stockBranchIds,
    legacyOrigin
  } = productBranchInfo(product);

  if (
    branchIds.includes(branchId)
    || Object.prototype.hasOwnProperty.call(stockByBranch, branchId)
  ) return true;

  if (branchId === DAPUR_BRANCH_ID) return false;

  if (branchId === SEBLAK_BRANCH_ID) {
    const assignedToDapur = branchIds.includes(DAPUR_BRANCH_ID)
      || Object.prototype.hasOwnProperty.call(
        stockByBranch,
        DAPUR_BRANCH_ID
      );

    if (assignedToDapur) return false;
    if (branchIds.length > 0) return false;
    if (legacyOrigin) return true;
    if (stockBranchIds.length === 0) return true;
    return false;
  }

  return false;
}

window.addEventListener('aya-data-changed', event => {
  const scopes = event.detail?.scopes || [];

  if (
    scopes.includes('products')
    || scopes.includes('branches')
  ) {
    cachedProducts = null;
    loadedAt = 0;
    pendingRequest = null;
  }
});
