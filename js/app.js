import { getBranches, getOnce, connectionInfo } from './store.js';
import { auth } from './firebase-config.js';
import { signOut } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { setupPWA } from './pwa.js';
import { renderDashboard } from './dashboard.js';
import { renderPOS } from './pos.js';
import { renderMaster, renderDirectory } from './master.js';
import { renderBranches, renderTransfers } from './branch.js';
import { renderPurchases, renderOperations, renderDebts } from './transaction.js';
import {
  renderEmployees,
  renderAttendance,
  renderCalculator,
  renderDocuments
} from './backoffice.js';
import { renderReports } from './reports.js';
import { renderCashReport } from './cash.js';
import { renderKitchen } from './kitchen.js';
import { renderUsers } from './users.js';
import { renderSettings } from './settings.js';

const rootHost = document.querySelector('#viewHost');
const nav = document.querySelector('#mainNav');
const branchSelector = document.querySelector('#branchSelector');
const sidebar = document.querySelector('#sidebar');

let branches = [];
let currentRoute = 'dashboard';
let navigationSequence = 0;
let user = {
  uid: 'guest',
  name: 'Belum Login',
  role: 'guest'
};

localStorage.removeItem('aya.session');

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
    label: 'Kasir / Penjualan',
    title: 'Kasir',
    subtitle: 'Transaksi cepat, pembayaran, nota, dan pesanan tertahan',
    roles: ['owner', 'supervisor', 'cashier'],
    render: renderPOS
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
    label: 'Absensi & Gaji',
    title: 'Absensi Karyawan',
    subtitle: 'Jam masuk, pulang, gaji, dan potongan kasbon',
    roles: ['owner', 'supervisor'],
    render: renderAttendance
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
  document.body.classList.toggle('auth-locked', user.role === 'guest');
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
    refreshBranches: loadBranches
  };
}

function firstAllowedRoute() {
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

function buildNav() {
  const locked = user.role === 'guest';

  document.body.classList.toggle('auth-locked', locked);
  branchSelector.hidden = locked;
  document.querySelector('#logoutButton').hidden = locked;

  nav.innerHTML = Object.entries(routes)
    .filter(([, route]) => route.roles.includes(user.role))
    .map(([id, route]) => `
      <button
        type="button"
        class="nav-item ${id === currentRoute ? 'active' : ''}"
        data-route="${id}"
      >
        <span class="nav-icon">${route.icon}</span>
        <span class="nav-label">${route.label}</span>
      </button>`)
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

  // Tidak memicu hashchange. Ini mencegah render satu rute berjalan dua kali.
  history.replaceState(
    null,
    '',
    `${location.pathname}${location.search}${nextHash}`
  );
}

async function navigate(requestedRoute, options = {}) {
  const {
    updateHash = true
  } = options;

  clearViewHandlers();

  let route = resolveRoute(requestedRoute);

  if (route === 'pos' && currentBranch().id === 'all') {
    const firstBranch = branches.find(branch => branch.active !== false);

    if (firstBranch) {
      branchSelector.value = firstBranch.id;
      localStorage.setItem('aya.branch', firstBranch.id);
    }
  }

  currentRoute = route;

  if (updateHash) updateRouteHash(route);

  const routeConfig = routes[route];
  const navigationId = ++navigationSequence;

  document.querySelector('#pageTitle').textContent = routeConfig.title;
  document.querySelector('#pageSubtitle').textContent = routeConfig.subtitle;
  buildNav();

  /*
   * Setiap navigasi mempunyai wadah sendiri.
   * Render lama yang selesai belakangan hanya dapat menulis ke wadah lama
   * yang sudah dilepas, sehingga tidak bisa menimpa halaman terbaru.
   */
  const viewMount = document.createElement('div');
  viewMount.className = 'route-view';
  viewMount.dataset.navigationId = String(navigationId);
  viewMount.innerHTML = document.querySelector('#loadingTemplate').innerHTML;

  rootHost.replaceChildren(viewMount);

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

      notify(error.message || 'Terjadi kesalahan', 'error');
    }
  }

  if (
    navigationId === navigationSequence
    && innerWidth <= 760
  ) {
    sidebar.classList.remove('open');
  }
}

async function loadBranches() {
  branches = await getBranches();

  const saved = localStorage.getItem('aya.branch');

  branchSelector.innerHTML = `
    ${user.role !== 'cashier'
      ? '<option value="all">Semua Cabang</option>'
      : ''}
    ${branches
      .filter(branch => branch.active !== false)
      .map(branch => `
        <option value="${branch.id}">${branch.name}</option>`)
      .join('')}
  `;

  branchSelector.value = [...branchSelector.options]
    .some(option => option.value === saved)
      ? saved
      : branches[0]?.id || 'all';

  localStorage.setItem('aya.branch', branchSelector.value);
}

function updateConnection(detail = connectionInfo()) {
  const state = document.querySelector('#connectionState');
  const queued = detail.queued ?? connectionInfo().queued;

  state.textContent = detail.connected
    ? `Online${queued ? ` · ${queued} antrean` : ''}`
    : `Offline · ${queued} antrean`;

  state.className = detail.connected
    ? 'success-text'
    : 'danger-text';
}

nav.addEventListener('click', event => {
  const button = event.target.closest('[data-route]');
  if (!button) return;

  event.preventDefault();
  navigate(button.dataset.route);
});

branchSelector.addEventListener('change', () => {
  localStorage.setItem('aya.branch', branchSelector.value);
  navigate(currentRoute);
});

document.querySelector('#sidebarToggle').onclick = () => (
  innerWidth <= 760
    ? sidebar.classList.toggle('open')
    : sidebar.classList.toggle('collapsed')
);

document.querySelector('#logoutButton').onclick = async () => {
  await signOut(auth);
  setUser({
    uid: 'guest',
    name: 'Belum Login',
    role: 'guest'
  });
  notify('Anda sudah keluar');
  navigate('users');
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
  await loadBranches();
  navigate(currentRoute);
});

window.addEventListener('aya-auth', async event => {
  if (!event.detail) {
    setUser({
      uid: 'guest',
      name: 'Belum Login',
      role: 'guest'
    });

    if (currentRoute !== 'users') navigate('users');
    return;
  }

  const profile = await getOnce(`users/${event.detail.uid}`);

  setUser({
    uid: event.detail.uid,
    email: event.detail.email,
    name: profile?.name || event.detail.email || 'User',
    role: profile?.role || 'cashier',
    branchId: profile?.branchId || ''
  });

  await loadBranches();

  if (currentRoute === 'users') {
    const preferredRoute = (
      profile?.role === 'owner'
      || profile?.role === 'supervisor'
    ) ? 'dashboard' : 'pos';

    navigate(preferredRoute);
  }
});

window.addEventListener('hashchange', () => {
  const requested = location.hash.slice(1);

  if (
    requested
    && requested !== currentRoute
  ) {
    navigate(requested, { updateHash: false });
  }
});

setupPWA(document.querySelector('#installButton'));
buildNav();
updateConnection();
navigate('users');
