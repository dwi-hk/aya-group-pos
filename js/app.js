import {
  getBranches,
  getOnce,
  connectionInfo,
  warmDataCache,
  invalidateDataCache
} from './store.js';
import { auth } from './firebase-config.js';
import {
  signOut
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { setupPWA } from './pwa.js';
import { renderDashboard } from './dashboard.js';
import { renderPOS } from './pos.js?v=2.19.0';
import { renderMaster, renderDirectory } from './master.js';
import { renderBranches, renderTransfers } from './branch.js';
import {
  renderPurchases,
  renderOperations,
  renderDebts
} from './transaction.js';
import {
  renderEmployees,
  renderCalculator,
  renderDocuments
} from './backoffice.js';
import { renderPayrollAttendance } from './payroll-v2.11.3.js?v=2.14.5';
import { renderReports } from './reports.js';
import { renderCashReport } from './cash.js';
import { renderKitchen } from './kitchen.js';
import { renderUsers } from './users.js';
import { renderSettings } from './settings.js';

const rootHost = document.querySelector('#viewHost');
const nav = document.querySelector('#mainNav');
const branchSelector = document.querySelector('#branchSelector');
const sidebar = document.querySelector('#sidebar');
const appShell = document.querySelector('#app');
const sidebarReveal = document.querySelector('#sidebarReveal');

function sidebarUsesDrawer() {
  return (
    innerWidth <= 760
    || (
      innerWidth <= 1100
      && window.matchMedia('(orientation: portrait)').matches
    )
  );
}

function ensureSidebarPortraitBackdrop() {
  let backdrop = document.querySelector('#sidebarPortraitBackdrop');

  if (!backdrop) {
    backdrop = document.createElement('button');
    backdrop.id = 'sidebarPortraitBackdrop';
    backdrop.type = 'button';
    backdrop.className = 'sidebar-portrait-backdrop';
    backdrop.setAttribute('aria-label', 'Tutup menu samping');
    backdrop.hidden = true;
    document.body.append(backdrop);

    backdrop.addEventListener('click', () => {
      sidebar.classList.remove('open');
      syncSidebarLayout();
    });
  }

  return backdrop;
}

let branches = [];
let currentRoute = 'users';
let navigationSequence = 0;
let warmupHandle = null;

let user = {
  uid: 'guest',
  name: 'Belum Login',
  role: 'guest'
};

localStorage.removeItem('aya.session');

const navGroups = [
  {
    id: 'transaksi',
    label: 'Transaksi',
    icon: '🧾',
    routes: ['pos', 'sales', 'purchases', 'transfers']
  },
  {
    id: 'barang',
    label: 'Barang & Stok',
    icon: '📦',
    routes: ['master', 'inventory', 'consignments']
  },
  {
    id: 'relasi',
    label: 'Pelanggan & Supplier',
    icon: '👥',
    routes: ['customers', 'suppliers', 'debts']
  },
  {
    id: 'karyawan',
    label: 'Karyawan',
    icon: '🧑‍🍳',
    routes: ['employees', 'attendance', 'documents']
  },
  {
    id: 'keuangan',
    label: 'Keuangan & Laporan',
    icon: '📈',
    routes: ['operations', 'cash', 'reports']
  },
  {
    id: 'operasional',
    label: 'Operasional',
    icon: '🏪',
    routes: ['dashboard', 'kitchen', 'calculator']
  },
  {
    id: 'administrasi',
    label: 'Administrasi',
    icon: '⚙️',
    routes: ['branches', 'settings', 'users']
  }
];

let openNavGroup = localStorage.getItem('aya.nav.group') || 'transaksi';

const routes = {
  dashboard: {
    icon: '📊',
    label: 'Dashboard Owner',
    title: 'Dashboard Owner',
    subtitle: 'Ringkasan usaha real-time',
    roles: ['owner', 'supervisor'],
    render: renderDashboard
  },
  pos: {
    icon: '🧾',
    label: 'Kasir',
    title: 'Kasir',
    subtitle: 'Transaksi cepat, pembayaran, nota, dan pesanan tertahan',
    roles: ['owner', 'supervisor', 'cashier'],
    render: renderPOS
  },
  sales: {
    icon: '🧮',
    label: 'Penjualan',
    title: 'Penjualan',
    subtitle: 'Riwayat nota dan transaksi penjualan',
    roles: ['owner', 'supervisor'],
    render: context => renderReports({
      ...context,
      initialSalesTab: 'notes'
    })
  },
  master: {
    icon: '📦',
    label: 'Master Barang & Stok',
    title: 'Master Barang',
    subtitle: 'Harga, barcode, stok, komposisi, dan label',
    roles: ['owner', 'supervisor', 'cashier'],
    render: renderMaster
  },
  customers: {
    icon: '👥',
    label: 'Data Pelanggan',
    title: 'Data Pelanggan',
    subtitle: 'Kontak, alamat, hutang, dan riwayat',
    roles: ['owner', 'supervisor'],
    render: context => renderDirectory(context, 'customers')
  },
  suppliers: {
    icon: '🚚',
    label: 'Data Supplier',
    title: 'Data Supplier',
    subtitle: 'Kontak, alamat, dan piutang supplier',
    roles: ['owner', 'supervisor'],
    render: context => renderDirectory(context, 'suppliers')
  },
  consignments: {
    icon: '🤝',
    label: 'Barang Titipan',
    title: 'Management Barang Titipan',
    subtitle: 'Masuk, terjual, dibayar, dan retur',
    roles: ['owner', 'supervisor'],
    render: context => renderDirectory(context, 'consignments')
  },
  branches: {
    icon: '🏬',
    label: 'Data Cabang',
    title: 'Data Cabang',
    subtitle: 'Tambah, ubah, dan pilih cabang',
    roles: ['owner'],
    render: renderBranches
  },
  inventory: {
    icon: '🛠️',
    label: 'Inventaris',
    title: 'Inventaris Cabang',
    subtitle: 'Alat operasional dan nilai pembelian',
    roles: ['owner', 'supervisor'],
    render: context => renderDirectory(context, 'inventory')
  },
  purchases: {
    icon: '🛒',
    label: 'Pembelian / Kulakan',
    title: 'Pembelian / Kulakan',
    subtitle: 'Pilih barang dari master dan tambah stok',
    roles: ['owner', 'supervisor', 'cashier'],
    render: renderPurchases
  },
  transfers: {
    icon: '🔁',
    label: 'Transfer Stok',
    title: 'Transfer Stok Antar Cabang',
    subtitle: 'Persetujuan dan penerimaan barang',
    roles: ['owner', 'supervisor'],
    render: renderTransfers
  },
  debts: {
    icon: '💳',
    label: 'Hutang & Kasbon',
    title: 'Hutang, Piutang, Kasbon',
    subtitle: 'Pembayaran dan jatuh tempo',
    roles: ['owner', 'supervisor'],
    render: renderDebts
  },
  employees: {
    icon: '🧑‍🍳',
    label: 'Data Karyawan',
    title: 'Manajemen Karyawan',
    subtitle: 'Gaji harian, kontak, alamat, dan kasbon',
    roles: ['owner'],
    render: renderEmployees
  },
  attendance: {
    icon: '📅',
    label: 'Gaji & Kasbon',
    title: 'Gaji & Kasbon',
    subtitle: 'Absensi device, saldo berjalan, pembayaran, dan laporan',
    roles: ['owner', 'supervisor'],
    render: renderPayrollAttendance
  },
  operations: {
    icon: '🧮',
    label: 'Operasional',
    title: 'Operasional Cabang',
    subtitle: 'Pengeluaran rinci per cabang',
    roles: ['owner', 'supervisor'],
    render: renderOperations
  },
  reports: {
    icon: '📈',
    label: 'Laporan Lengkap',
    title: 'Laporan',
    subtitle: 'Penjualan, pembelian, laba/rugi, barang laris, dan pembayaran',
    roles: ['owner', 'supervisor'],
    render: renderReports
  },
  cash: {
    icon: '💵',
    label: 'Kas & Rekonsiliasi',
    title: 'Kas & Rekonsiliasi',
    subtitle: 'Kas sistem, uang fisik di laci, dan selisih kas',
    roles: ['owner', 'supervisor'],
    render: renderCashReport
  },
  kitchen: {
    icon: '🍳',
    label: 'Kitchen Display',
    title: 'Kitchen Display',
    subtitle: 'Antrian dan status pesanan',
    roles: ['owner', 'supervisor', 'cashier'],
    render: renderKitchen
  },
  calculator: {
    icon: '🔢',
    label: 'Kalkulator',
    title: 'Kalkulator',
    subtitle: 'Hitung cepat operasional',
    roles: ['owner', 'supervisor', 'cashier'],
    render: renderCalculator
  },
  documents: {
    icon: '📄',
    label: 'SOP & Perjanjian',
    title: 'Dokumen Karyawan',
    subtitle: 'Surat perjanjian kerja dan SOP profesional',
    roles: ['owner'],
    render: renderDocuments
  },
  users: {
    icon: '🔐',
    label: 'Akun & Login',
    title: 'Akun & Management User',
    subtitle: 'Login Firebase dan pengaturan akses user',
    roles: ['guest', 'owner', 'supervisor', 'cashier'],
    render: renderUsers
  },
  settings: {
    icon: '⚙️',
    label: 'Setting',
    title: 'Pengaturan',
    subtitle: 'Nota, printer, backup, restore, dan data awal',
    roles: ['owner'],
    render: renderSettings
  }
};

function notify(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;

  document.querySelector('#alertHost').append(toast);
  setTimeout(() => toast.remove(), 4200);
}

function dialog(title, body, footer = '') {
  const appDialog = document.querySelector('#appDialog');

  if (appDialog.open) appDialog.close();

  document.querySelector('#dialogTitle').textContent = title;
  document.querySelector('#dialogBody').innerHTML = body;
  document.querySelector('#dialogFooter').innerHTML = footer;
  appDialog.showModal();
}

function setUser(next) {
  user = next;

  document.body.classList.toggle(
    'auth-locked',
    user.role === 'guest'
  );

  document.querySelector('#currentUserBadge').textContent =
    `${user.name} · ${user.role}`;

  buildNav();
}

function currentBranch() {
  const id = (
    branchSelector.value
    || localStorage.getItem('aya.branch')
    || branches[0]?.id
  );

  if (id === 'all') {
    return {
      id: 'all',
      name: 'Semua Cabang',
      code: 'ALL'
    };
  }

  return (
    branches.find(branch => branch.id === id)
    || branches[0]
    || {
      id: 'local',
      name: 'Cabang Lokal',
      code: 'AYA'
    }
  );
}

function context(viewHost = rootHost) {
  return {
    host: viewHost,
    branch: currentBranch(),
    branches,
    user,
    notify,
    dialog,
    setUser,
    navigate,
    refreshBranches: loadBranches,
    refreshData: paths => {
      invalidateDataCache(paths || 'all');
      return navigate(currentRoute, { force: true });
    }
  };
}

function firstAllowedRoute() {
  if (
    user.role !== 'guest'
    && routes.pos.roles.includes(user.role)
  ) {
    return 'pos';
  }

  return (
    Object.entries(routes)
      .find(([, route]) => route.roles.includes(user.role))?.[0]
    || 'users'
  );
}

function resolveRoute(route) {
  const requested = routes[route];

  if (!requested || !requested.roles.includes(user.role)) {
    return firstAllowedRoute();
  }

  return route;
}

function activeNavGroupId() {
  return navGroups.find(group =>
    group.routes.includes(currentRoute)
  )?.id || '';
}

function buildNav() {
  const locked = user.role === 'guest';

  document.body.classList.toggle('auth-locked', locked);
  branchSelector.hidden = locked;
  document.querySelector('#logoutButton').hidden = locked;

  const allowedRoutes = new Set(
    Object.entries(routes)
      .filter(([, route]) => route.roles.includes(user.role))
      .map(([id]) => id)
  );

  const activeGroup = activeNavGroupId();

  if (activeGroup) {
    openNavGroup = activeGroup;
    localStorage.setItem('aya.nav.group', activeGroup);
  }

  nav.innerHTML = navGroups
    .map(group => {
      const visibleRouteIds = group.routes
        .filter(id => allowedRoutes.has(id));

      if (!visibleRouteIds.length) return '';

      const groupActive = visibleRouteIds.includes(currentRoute);
      const open = group.id === openNavGroup;

      const items = visibleRouteIds
        .map(id => {
          const route = routes[id];
          const active = id === currentRoute;

          return `
            <button
              type="button"
              class="nav-item nav-subitem ${active ? 'active' : ''}"
              data-route="${id}"
              title="${route.label}"
              aria-current="${active ? 'page' : 'false'}"
            >
              <span class="nav-icon" aria-hidden="true">${route.icon}</span>
              <span class="nav-label">${route.label}</span>
              <span class="nav-chevron" aria-hidden="true">›</span>
            </button>`;
        })
        .join('');

      return `
        <section
          class="nav-section ${open ? 'open' : ''} ${groupActive ? 'active-group' : ''}"
          data-nav-group="${group.id}"
        >
          <button
            type="button"
            class="nav-parent ${groupActive ? 'active' : ''}"
            data-nav-parent="${group.id}"
            aria-expanded="${open ? 'true' : 'false'}"
            aria-controls="nav-group-${group.id}"
          >
            <span class="nav-parent-icon" aria-hidden="true">${group.icon}</span>
            <span class="nav-parent-label">${group.label}</span>
            <span class="nav-parent-chevron" aria-hidden="true">⌄</span>
          </button>
          <div
            id="nav-group-${group.id}"
            class="nav-section-items"
            ${open ? '' : 'hidden'}
          >${items}</div>
        </section>`;
    })
    .join('');

  document.querySelector('#currentUserBadge').textContent =
    `${user.name} · ${user.role}`;
}

function clearViewHandlers() {
  for (const name of [
    'onclick',
    'onchange',
    'oninput',
    'onsubmit',
    'onkeydown',
    'onkeyup'
  ]) {
    rootHost[name] = null;
  }
}

function updateRouteHash(route) {
  const nextHash = `#${route}`;
  if (location.hash === nextHash) return;

  history.replaceState(
    null,
    '',
    `${location.pathname}${location.search}${nextHash}`
  );
}

function currentViewMatches(route) {
  const mount = rootHost.firstElementChild;

  return (
    mount?.dataset?.route === route
    && mount?.dataset?.branch === currentBranch().id
    && mount?.dataset?.user === user.uid
  );
}

async function navigate(requestedRoute, options = {}) {
  const {
    updateHash = true,
    force = false
  } = options;

  clearViewHandlers();

  const route = resolveRoute(requestedRoute);

  if (route === 'pos' && currentBranch().id === 'all') {
    const firstBranch = branches.find(
      branch => branch.active !== false
    );

    if (firstBranch) {
      branchSelector.value = firstBranch.id;
      localStorage.setItem('aya.branch', firstBranch.id);
    }
  }

  if (
    !force
    && route === currentRoute
    && currentViewMatches(route)
  ) {
    if (updateHash) updateRouteHash(route);
    return;
  }

  currentRoute = route;

  if (updateHash) updateRouteHash(route);

  const routeConfig = routes[route];
  const navigationId = ++navigationSequence;

  document.querySelector('#pageTitle').textContent =
    routeConfig.title;

  document.querySelector('#pageSubtitle').textContent =
    routeConfig.subtitle;

  buildNav();

  const viewMount = document.createElement('div');

  viewMount.className = 'route-view';
  viewMount.dataset.navigationId = String(navigationId);
  viewMount.dataset.route = route;
  viewMount.dataset.branch = currentBranch().id;
  viewMount.dataset.user = user.uid;

  rootHost.replaceChildren(viewMount);

  /*
   * Spinner baru muncul bila proses benar-benar lebih dari 140 ms.
   * Tab yang memakai cache tidak lagi berkedip "Memuat data…".
   */
  const loadingTimer = setTimeout(() => {
    if (
      navigationId === navigationSequence
      && viewMount.isConnected
      && !viewMount.childElementCount
    ) {
      viewMount.innerHTML =
        document.querySelector('#loadingTemplate').innerHTML;
    }
  }, 140);

  try {
    await routeConfig.render(context(viewMount));
  } catch (error) {
    console.error(`Route ${route} gagal:`, error);

    const stillCurrent = (
      navigationId === navigationSequence
      && viewMount.isConnected
      && currentRoute === route
    );

    if (stillCurrent) {
      viewMount.innerHTML = `
        <div class="card">
          <h2>Modul gagal dimuat</h2>
          <p class="danger-text">${String(error.message || error)}</p>
          <p class="muted">
            Periksa koneksi, Firebase Security Rules, dan Console browser.
          </p>
        </div>`;

      notify(
        error.message || 'Terjadi kesalahan',
        'error'
      );
    }
  } finally {
    clearTimeout(loadingTimer);
  }

  if (
    navigationId === navigationSequence
    && sidebarUsesDrawer()
  ) {
    sidebar.classList.remove('open');
    syncSidebarLayout();
  }
}

async function loadBranches({ force = false } = {}) {
  branches = await getBranches({ force });

  const saved = localStorage.getItem('aya.branch');

  branchSelector.innerHTML = `
    ${user.role !== 'cashier'
      ? '<option value="all">Semua Cabang</option>'
      : ''}
    ${branches
      .filter(branch => branch.active !== false)
      .map(branch => `
        <option value="${branch.id}">
          ${branch.name}
        </option>`)
      .join('')}
  `;

  branchSelector.value = [...branchSelector.options]
    .some(option => option.value === saved)
      ? saved
      : branches[0]?.id || 'all';

  localStorage.setItem(
    'aya.branch',
    branchSelector.value
  );
}

function scheduleWarmup() {
  if (warmupHandle) {
    if ('cancelIdleCallback' in window) {
      cancelIdleCallback(warmupHandle);
    } else {
      clearTimeout(warmupHandle);
    }
  }

  const run = () => {
    warmupHandle = null;

    warmDataCache([
      'sales',
      'operations',
      'debts',
      'purchases',
      'capital'
    ]).catch(error => {
      console.warn('Background cache:', error.message);
    });
  };

  if ('requestIdleCallback' in window) {
    warmupHandle = requestIdleCallback(run, {
      timeout: 5000
    });
  } else {
    warmupHandle = setTimeout(run, 2200);
  }
}

function updateConnection(detail = connectionInfo()) {
  const state = document.querySelector('#connectionState');
  const queued = (
    detail.queued
    ?? connectionInfo().queued
  );

  state.textContent = detail.connected
    ? `Online${queued ? ` · ${queued} antrean` : ''}`
    : `Offline · ${queued} antrean`;

  state.className = detail.connected
    ? 'success-text'
    : 'danger-text';
}

function syncSidebarLayout() {
  const drawer = sidebarUsesDrawer();
  const backdrop = ensureSidebarPortraitBackdrop();

  if (drawer) {
    /* Di mode drawer, sidebar benar-benar keluar ke kiri.
       Class collapsed milik desktop dibersihkan agar tidak menyisakan lebar 74px. */
    sidebar.classList.remove('collapsed');
    appShell.classList.remove('sidebar-hidden');

    const open = sidebar.classList.contains('open');
    sidebarReveal.hidden = open;
    backdrop.hidden = !open;
    document.body.classList.toggle('sidebar-portrait-open', open);
    return;
  }

  sidebar.classList.remove('open');
  backdrop.hidden = true;
  document.body.classList.remove('sidebar-portrait-open');

  const hidden = sidebar.classList.contains('collapsed');
  appShell.classList.toggle('sidebar-hidden', hidden);
  sidebarReveal.hidden = !hidden;
}

nav.addEventListener('click', event => {
  const parent = event.target.closest('[data-nav-parent]');

  if (parent) {
    event.preventDefault();

    const groupId = parent.dataset.navParent;
    const section = parent.closest('.nav-section');
    const items = section?.querySelector('.nav-section-items');
    const willOpen = !section?.classList.contains('open');

    nav.querySelectorAll('.nav-section').forEach(group => {
      const groupItems = group.querySelector('.nav-section-items');
      const groupButton = group.querySelector('[data-nav-parent]');
      group.classList.remove('open');
      if (groupItems) groupItems.hidden = true;
      if (groupButton) groupButton.setAttribute('aria-expanded', 'false');
    });

    if (willOpen && section && items) {
      section.classList.add('open');
      items.hidden = false;
      parent.setAttribute('aria-expanded', 'true');
      openNavGroup = groupId;
      localStorage.setItem('aya.nav.group', groupId);
    } else {
      openNavGroup = '';
      localStorage.removeItem('aya.nav.group');
    }

    return;
  }

  const button = event.target.closest('[data-route]');
  if (!button) return;

  event.preventDefault();
  navigate(button.dataset.route);
});

branchSelector.addEventListener('change', () => {
  localStorage.setItem(
    'aya.branch',
    branchSelector.value
  );

  navigate(currentRoute, {
    force: true
  });
});

document.querySelector('#sidebarToggle').onclick = () => {
  if (sidebarUsesDrawer()) {
    sidebar.classList.toggle('open');
  } else {
    sidebar.classList.toggle('collapsed');
  }
  syncSidebarLayout();
};

sidebarReveal.onclick = () => {
  if (sidebarUsesDrawer()) {
    sidebar.classList.add('open');
  } else {
    sidebar.classList.remove('collapsed');
  }
  syncSidebarLayout();
};

window.addEventListener('resize', syncSidebarLayout);
window.addEventListener('orientationchange', () => {
  window.setTimeout(syncSidebarLayout, 80);
});
syncSidebarLayout();

document.querySelector('#logoutButton').onclick = async () => {
  await signOut(auth);
  invalidateDataCache('all');

  setUser({
    uid: 'guest',
    name: 'Belum Login',
    role: 'guest'
  });

  notify('Anda sudah keluar');

  navigate('users', {
    force: true
  });
};

window.addEventListener('aya-connection', event => {
  updateConnection(event.detail);
});

window.addEventListener('aya-queue', event => {
  updateConnection({
    ...connectionInfo(),
    queued: event.detail
  });
});

window.addEventListener('aya-branches-changed', async () => {
  await loadBranches({ force: true });

  navigate(currentRoute, {
    force: true
  });
});

window.addEventListener('aya-auth', async event => {
  if (!event.detail) {
    setUser({
      uid: 'guest',
      name: 'Belum Login',
      role: 'guest'
    });

    if (currentRoute !== 'users') {
      navigate('users', {
        force: true
      });
    }

    return;
  }

  const profile = await getOnce(
    `users/${event.detail.uid}`
  );

  setUser({
    uid: event.detail.uid,
    email: event.detail.email,
    name: profile?.name || event.detail.email || 'User',
    role: profile?.role || 'cashier',
    branchId: profile?.branchId || ''
  });

  await loadBranches();

  /*
   * Semua akun langsung ke Kasir.
   * Dashboard tidak dimuat dulu, sehingga login tidak menjalankan
   * dua halaman berat secara berurutan.
   */
  await navigate('pos', {
    force: true
  });

  scheduleWarmup();
});

window.addEventListener('hashchange', () => {
  const requested = location.hash.slice(1);

  if (
    requested
    && requested !== currentRoute
  ) {
    navigate(requested, {
      updateHash: false
    });
  }
});

setupPWA(
  document.querySelector('#installButton')
);

buildNav();
updateConnection();
navigate('users', {
  force: true
});
