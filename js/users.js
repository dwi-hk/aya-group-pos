import { firebaseConfig, auth } from './firebase-config.js';
import {
  initializeApp,
  deleteApp
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  createUserWithEmailAndPassword
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  getOnce,
  setData,
  removeData
} from './store.js';
import {
  toArray,
  escapeHTML,
  formObject
} from './utils.js';

export async function renderUsers(ctx) {
  const realOwner = (
    ctx.user.role === 'owner'
    && ctx.user.uid !== 'guest'
  );

  let profiles = realOwner
    ? toArray(await getOnce('users'))
    : [];

  const draw = () => {
    const management = realOwner
      ? `<article class="card">
          <div class="toolbar">
            <div>
              <h2>Management User</h2>
              <p class="muted">
                Owner terautentikasi dapat membuat akun dan menentukan peran.
              </p>
            </div>
            <button id="addUser" class="primary-button">+ User</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Email</th>
                  <th>Peran</th>
                  <th>Cabang</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                ${profiles.map(profile => `
                  <tr>
                    <td>${escapeHTML(profile.name)}</td>
                    <td>${escapeHTML(profile.email)}</td>
                    <td><span class="badge">${escapeHTML(profile.role)}</span></td>
                    <td>${escapeHTML(profile.branchId || 'Semua')}</td>
                    <td>
                      <button class="icon-button" data-delete="${profile.id}">
                        🗑️
                      </button>
                    </td>
                  </tr>`).join('') || '<tr><td colspan="5">Belum ada profil user.</td></tr>'}
              </tbody>
            </table>
          </div>
        </article>`
      : `<article class="card">
          <h2>Akses User</h2>
          <p class="muted">
            Daftar user dan pembuatan akun hanya tersedia setelah login sebagai Owner Firebase.
          </p>
        </article>`;

    ctx.host.innerHTML = `
      <div class="grid two">
        <article class="card">
          <h2>Login Firebase</h2>
          <p class="muted">
            Gunakan akun Email/Password dari Firebase Authentication.
          </p>
          <form id="loginForm" class="form-grid">
            <label class="full">
              Email
              <input name="email" type="email" required>
            </label>
            <label class="full">
              Password
              <input name="password" type="password" required>
            </label>
            <button class="primary-button">Masuk</button>
            <button
              type="button"
              id="firebaseLogout"
              class="secondary-button"
            >
              Keluar Firebase
            </button>
          </form>
          <hr style="border-color:var(--line);margin:20px 0">
          <p class="muted">
            Sesi saat ini:
            ${escapeHTML(ctx.user.name)} · ${escapeHTML(ctx.user.role)}
          </p>
        </article>
        ${management}
      </div>`;

    bind();
  };

  const bind = () => {
    document.querySelector('#loginForm').onsubmit = async event => {
      event.preventDefault();

      const values = formObject(event.currentTarget);

      try {
        const credential = await signInWithEmailAndPassword(
          auth,
          values.email,
          values.password
        );

        const profile = await getOnce(
          `users/${credential.user.uid}`
        );

        ctx.setUser({
          uid: credential.user.uid,
          email: credential.user.email,
          name: profile?.name || credential.user.email,
          role: profile?.role || 'cashier',
          branchId: profile?.branchId || ''
        });

        await ctx.refreshBranches();
        ctx.notify('Login berhasil');

        /*
         * Tidak lagi membuka Dashboard untuk akun Owner.
         * Langsung ke Kasir agar tidak memuat dua tab berat.
         */
        await ctx.navigate('pos');
      } catch (error) {
        ctx.notify(
          friendlyAuth(error),
          'error'
        );
      }
    };

    document.querySelector('#firebaseLogout').onclick = async () => {
      await signOut(auth);

      ctx.setUser({
        uid: 'guest',
        name: 'Belum Login',
        role: 'guest'
      });

      ctx.notify(
        'Anda sudah keluar dari Firebase'
      );

      ctx.navigate('users', {
        force: true
      });
    };

    document.querySelector('#addUser')
      ?.addEventListener('click', () =>
        userForm(ctx, async data => {
          let secondary;

          try {
            secondary = initializeApp(
              firebaseConfig,
              `secondary-${Date.now()}`
            );

            const secondaryAuth = getAuth(secondary);

            const credential =
              await createUserWithEmailAndPassword(
                secondaryAuth,
                data.email,
                data.password
              );

            await setData(
              `users/${credential.user.uid}`,
              {
                name: data.name,
                email: data.email,
                role: data.role,
                branchId: data.branchId,
                active: true,
                createdAt: Date.now()
              }
            );

            await signOut(secondaryAuth);

            profiles.push({
              id: credential.user.uid,
              ...data
            });

            draw();
            ctx.notify('User Firebase dibuat');
          } catch (error) {
            ctx.notify(
              friendlyAuth(error),
              'error'
            );
          } finally {
            if (secondary) {
              await deleteApp(secondary).catch(() => {});
            }
          }
        })
      );

    ctx.host.querySelector('tbody')
      ?.addEventListener('click', async event => {
        const button = event.target.closest('[data-delete]');

        if (
          button
          && confirm(
            'Hapus profil akses user? Akun Firebase Authentication harus dihapus melalui Console/Admin SDK.'
          )
        ) {
          await removeData(
            `users/${button.dataset.delete}`
          );

          profiles = profiles.filter(
            profile => profile.id !== button.dataset.delete
          );

          draw();
        }
      });
  };

  draw();
}

function userForm(ctx, onSave) {
  ctx.dialog(
    'Tambah User',
    `<form id="userForm" class="form-grid">
      <label>
        Nama
        <input name="name" required>
      </label>
      <label>
        Email
        <input name="email" type="email" required>
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          minlength="6"
          required
        >
      </label>
      <label>
        Peran
        <select name="role">
          <option value="cashier">Kasir</option>
          <option value="supervisor">Supervisor</option>
          <option value="owner">Owner</option>
        </select>
      </label>
      <label class="full">
        ID Cabang
        <input
          name="branchId"
          placeholder="Kosongkan untuk semua cabang"
        >
      </label>
    </form>`,
    `<button value="cancel" class="secondary-button">Batal</button>
     <button id="saveUser" class="primary-button">Buat User</button>`
  );

  document.querySelector('#saveUser').onclick = async event => {
    event.preventDefault();

    const form = document.querySelector('#userForm');
    if (!form.reportValidity()) return;

    await onSave(formObject(form));
    document.querySelector('#appDialog').close();
  };
}

function friendlyAuth(error) {
  const code = error?.code || '';

  if (code.includes('invalid-credential')) {
    return 'Email atau password salah.';
  }

  if (code.includes('email-already')) {
    return 'Email sudah terdaftar.';
  }

  if (code.includes('weak-password')) {
    return 'Password minimal 6 karakter.';
  }

  return error.message || 'Autentikasi gagal.';
}
