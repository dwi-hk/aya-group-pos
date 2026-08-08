import { getProducts } from './store.js';

const CACHE_LIFETIME = 5 * 60 * 1000;
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

  pendingRequest = getProducts()
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

export function invalidateProductCache() {
  cachedProducts = null;
  loadedAt = 0;
  pendingRequest = null;
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
    || Object.prototype.hasOwnProperty.call(stockByBranch, branchId)
  ) return true;

  const hasExplicitAssignment = (
    branchIds.length > 0
    || Object.keys(stockByBranch).length > 0
  );

  if (hasExplicitAssignment) return false;

  // Data menu lama tanpa penanda cabang dianggap sebagai menu AYA Seblak.
  return branchId === 'aya-seblak-angkringan';
}
