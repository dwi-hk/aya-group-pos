@echo off
setlocal
title AYA POS - 1 KLIK DEPLOY
cd /d "%~dp0"

echo.
echo ==============================================
echo      AYA POS - 1 KLIK DEPLOY FIREBASE
echo ==============================================
echo.

if not exist "firebase.json" (
  echo [ERROR] firebase.json tidak ditemukan.
  echo.
  echo CARA BENAR:
  echo 1. Copy file ini ke FOLDER UTAMA AYA POS
  echo 2. Folder utama harus berisi firebase.json
  echo 3. Lalu double-click file ini lagi.
  echo.
  pause
  exit /b 1
)

if not exist "js\pos.js" (
  echo [ERROR] js\pos.js tidak ditemukan.
  echo Pastikan folder js ada di folder utama AYA POS.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js belum terpasang di komputer ini.
  echo.
  echo Jangan tutup jendela ini.
  echo Kirim FOTO layar ini ke ChatGPT.
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm belum tersedia.
  echo Kirim FOTO layar ini ke ChatGPT.
  echo.
  pause
  exit /b 1
)

echo [1/3] Memeriksa login Firebase...
call npx --yes firebase-tools@latest login:list > "%TEMP%\aya-firebase-login.txt" 2>&1
type "%TEMP%\aya-firebase-login.txt"
findstr /i /c:"No authorized accounts" "%TEMP%\aya-firebase-login.txt" >nul
if not errorlevel 1 (
  echo.
  echo [2/3] Login Firebase diperlukan.
  echo Browser akan dibuka. Silakan login dengan akun Firebase Anda.
  echo Setelah login selesai, kembali ke jendela hitam ini.
  echo.
  call npx --yes firebase-tools@latest login
  if errorlevel 1 (
    echo.
    echo [ERROR] Login Firebase gagal.
    echo Kirim FOTO layar ini ke ChatGPT.
    echo.
    pause
    exit /b 1
  )
) else (
  echo.
  echo [2/3] Login Firebase sudah tersedia.
)

echo.
echo [3/3] Deploy AYA POS ke Firebase Hosting...
echo.
call npx --yes firebase-tools@latest deploy --only hosting --project kasir-aya-group-e6fb4

if errorlevel 1 (
  echo.
  echo ==============================================
  echo               DEPLOY GAGAL
  echo ==============================================
  echo.
  echo Jangan tutup jendela ini.
  echo Kirim FOTO layar error ini ke ChatGPT.
  echo.
  pause
  exit /b 1
)

echo.
echo ==============================================
echo              DEPLOY BERHASIL
echo ==============================================
echo.
echo Langkah terakhir:
echo 1. Tutup SEMUA tab AYA POS.
echo 2. Buka kembali AYA POS.
echo 3. Tekan CTRL + F5 satu kali.
echo 4. Tes SIMPAN lalu CETAK.
echo.
pause
