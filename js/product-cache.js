import {
  getProducts,
  invalidateDataCache
} from './store.js';

const CACHE_LIFETIME = 10 * 60 * 1000;

let cachedProducts = null;
let loadedAt = 0;
let pendingRequest = null;

export async function getCachedProducts({ force = false } = {}) {
  const cacheIsFresh = (
    Array.isArray(cachedProducts)
    && Date.now() - loadedAt < CACHE_LIFETIME
  );

  if (!force && cacheIsFresh) return cachedProducts;
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

export function invalidateProductCache({
  includeStore = true
} = {}) {
  cachedProducts = null;
  loadedAt = 0;
  pendingRequest = null;

  if (includeStore) {
    invalidateDataCache('products');
  }
}

export function productBelongsToBranch(product, branchId) {
  if (!product || branchId === 'all') return true;

  const branchIds = Array.isArray(product.branchIds)
    ? product.branchIds.map(String)
    : [];

  const stockByBranch = (
    product.stockByBranch
    && typeof product.stockByBranch === 'object'
  ) ? product.stockByBranch : {};

  if (
    branchIds.includes(branchId)
    || Object.prototype.hasOwnProperty.call(
      stockByBranch,
      branchId
    )
  ) {
    return true;
  }

  const hasExplicitAssignment = (
    branchIds.length > 0
    || Object.keys(stockByBranch).length > 0
  );

  if (hasExplicitAssignment) return false;

  return branchId === 'aya-seblak-angkringan';
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
