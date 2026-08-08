import { auth } from './firebase-config.js';
import {
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';

let redirectToken = 0;

function openKasirAfterLogin() {
  const token = ++redirectToken;
  const startedAt = Date.now();
  const maximumDuration = 12000;

  const check = () => {
    if (token !== redirectToken || !auth.currentUser) return;

    const badge = document.querySelector('#currentUserBadge');
    const kasirButton = document.querySelector('[data-route="pos"]');
    const loggedIn = badge
      && !String(badge.textContent || '').toLowerCase().includes('guest')
      && !String(badge.textContent || '').toLowerCase().includes('belum login');

    if (loggedIn && kasirButton && location.hash !== '#pos') {
      kasirButton.click();
    }

    if (Date.now() - startedAt < maximumDuration) {
      setTimeout(check, 350);
    }
  };

  setTimeout(check, 250);
}

onAuthStateChanged(auth, user => {
  if (user) openKasirAfterLogin();
  else redirectToken++;
});

window.addEventListener('aya-auth', event => {
  if (event.detail) openKasirAfterLogin();
});
