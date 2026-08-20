@echo off
title AYA POS - Deploy Fix Popup ke Firebase
cd /d "%~dp0"

echo =============================================
echo AYA POS - DEPLOY FIX POPUP SIMPAN + CETAK
echo =============================================
echo.
echo File yang akan dipakai:
echo   js\pos.js
echo   sw.js
echo.
echo Memeriksa Firebase CLI...
where firebase >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: Firebase CLI belum ditemukan.
  echo Install dulu dengan:
  echo npm install -g firebase-tools
  echo.
  pause
  exit /b 1
)

echo.
echo Deploy ke Firebase project kasir-aya-group-e6fb4...
firebase deploy --only hosting --project kasir-aya-group-e6fb4

if errorlevel 1 (
  echo.
  echo DEPLOY GAGAL.
  echo Pastikan sudah login Firebase dengan: firebase login
  echo.
  pause
  exit /b 1
)

echo.
echo =============================================
echo DEPLOY BERHASIL
echo =============================================
echo.
echo Setelah ini:
echo 1. Tutup semua tab AYA POS.
echo 2. Buka lagi aplikasinya.
echo 3. Tekan Ctrl+F5 satu kali.
echo 4. Tes: SIMPAN lalu CETAK.
echo    Setelah keduanya berhasil, popup akan menutup otomatis.
echo.
pause
