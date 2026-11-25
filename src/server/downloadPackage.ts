import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

const ROOT_FILES = [
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'index.html',
  'metadata.json',
  'server.ts',
  '.env.example',
];

function addDirectoryRecursive(
  zip: JSZip,
  absDir: string,
  zipRelDir: string,
  skipSubdirs: string[] = []
) {
  if (!fs.existsSync(absDir)) return;
  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    const fullPath = path.join(absDir, entry.name);
    const targetZipPath = path.posix.join(zipRelDir, entry.name);
    if (entry.isDirectory()) {
      if (skipSubdirs.includes(targetZipPath)) {
        continue;
      }
      addDirectoryRecursive(zip, fullPath, targetZipPath, skipSubdirs);
    } else if (entry.isFile()) {
      zip.file(targetZipPath, fs.readFileSync(fullPath));
    }
  }
}

export async function buildProgramZipBuffer(): Promise<Buffer> {
  const zip = new JSZip();
  const rootDir = process.cwd();

  for (const fileName of ROOT_FILES) {
    const absPath = path.join(rootDir, fileName);
    if (fs.existsSync(absPath)) {
      zip.file(fileName, fs.readFileSync(absPath));
    }
  }

  addDirectoryRecursive(zip, path.join(rootDir, 'src'), 'src');
  addDirectoryRecursive(zip, path.join(rootDir, 'public'), 'public', ['public/assets']);

  zip.file(
    'Start-FlowTrend-IQ.bat',
    `@echo off
setlocal
cd /d "%~dp0"
title FlowTrend IQ - 1m Trend Scanner
echo ============================================
echo   FlowTrend IQ - 1 Minute Trend Scanner
echo ============================================
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
echo Starting FlowTrend IQ Desktop App Window...
start "" /b cmd /c "timeout /t 3 /nobreak >nul & (where msedge >nul 2>nul && start msedge --app=http://localhost:3000 || (where chrome >nul 2>nul && start chrome --app=http://localhost:3000 || start "" http://localhost:3000))"
call npm run dev
pause
`
  );

  zip.file(
    'Install-FlowTrend-IQ-Windows.bat',
    `@echo off
setlocal
cd /d "%~dp0"
title Installing FlowTrend IQ Desktop App
echo =====================================================
echo   Installing FlowTrend IQ onto Windows Desktop...
echo =====================================================
if not exist node_modules (
  echo [1/2] Installing required packages...
  call npm install
) else (
  echo [1/2] Packages already installed.
)

echo [2/2] Creating Desktop App Launcher & Shortcut...
set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\\" set "APP_DIR=%APP_DIR:~0,-1%"

(
  echo Set WshShell = CreateObject^("WScript.Shell"^)
  echo WshShell.CurrentDirectory = "%APP_DIR%"
  echo WshShell.Run "cmd /c npm run dev", 0, False
  echo WScript.Sleep 3200
  echo On Error Resume Next
  echo Err.Clear
  echo WshShell.Run "msedge --app=http://localhost:3000", 1, False
  echo If Err.Number ^<^> 0 Then
  echo   Err.Clear
  echo   WshShell.Run "chrome --app=http://localhost:3000", 1, False
  echo   If Err.Number ^<^> 0 Then
  echo     WshShell.Run "http://localhost:3000", 1, False
  echo   End If
  echo End If
) > "%APP_DIR%\\Launch-FlowTrend-App.vbs"

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\\FlowTrend IQ.lnk'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%APP_DIR%\\Launch-FlowTrend-App.vbs\"'; $s.WorkingDirectory = '%APP_DIR%'; if (Test-Path '%APP_DIR%\\public\\favicon.ico') { $s.IconLocation = '%APP_DIR%\\public\\favicon.ico' }; $s.Save()"

echo.
echo =====================================================
echo   Done! Shortcut "FlowTrend IQ" created on Desktop.
echo   Launching FlowTrend IQ App Window now...
echo =====================================================
start "" wscript.exe "%APP_DIR%\\Launch-FlowTrend-App.vbs"
timeout /t 2 /nobreak >nul
`
  );

  zip.file(
    'Start-FlowTrend-IQ.command',
    `#!/bin/bash
cd "$(dirname "$0")"
if [ ! -d "node_modules" ]; then
  npm install
fi
(sleep 3 && (open -na "Google Chrome" --args --app=http://localhost:3000 2>/dev/null || open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null)) &
npm run dev
`
  );

  zip.file(
    'Start-Android-Termux.sh',
    `#!/data/data/com.termux/files/usr/bin/bash
set -e
cd "$(dirname "$0")"
echo "============================================"
echo "  FlowTrend IQ - Android Termux Launcher"
echo "============================================"
if ! command -v node >/dev/null 2>&1; then
  echo "Installing Node.js..."
  pkg update -y && pkg install -y nodejs-lts
fi
if [ ! -d "node_modules" ]; then
  echo "Installing packages..."
  npm install
fi
echo "Open Google Chrome on Android once at: http://localhost:3000"
echo "Then tap Chrome Menu -> Install App to place FlowTrendIQ on your Android Home Screen."
npm run dev
`
  );

  zip.file(
    'electron/main.cjs',
    `const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

let mainWindow = null;
let serverProc = null;

function waitForServer(url, retries = 30) {
  return new Promise((resolve, reject) => {
    const check = (left) => {
      http
        .get(url, (res) => {
          res.resume();
          resolve();
        })
        .on('error', () => {
          if (left <= 0) reject(new Error('Server timeout'));
          else setTimeout(() => check(left - 1), 400);
        });
    };
    check(retries);
  });
}

async function createWindow() {
  const rootDir = path.resolve(__dirname, '..');
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  serverProc = spawn(npxCmd, ['tsx', 'server.ts'], {
    cwd: rootDir,
    env: { ...process.env, PORT: '3000' },
    stdio: 'ignore',
  });

  await waitForServer('http://localhost:3000');

  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    backgroundColor: '#0B111E',
    autoHideMenuBar: true,
    title: 'FlowTrend IQ',
    icon: path.join(rootDir, 'public/pwa-512x512.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL('http://localhost:3000');
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (serverProc) serverProc.kill();
  app.quit();
});
`
  );

  zip.file(
    'electron/README-Build-EXE.txt',
    `คู่มือต่อยอดทำไฟล์ติดตั้ง .exe (Windows) ด้วย Electron:
1. ติดตั้ง electron และ electron-builder ในโฟลเดอร์โปรเจกต์:
   npm install -D electron electron-builder
2. เพิ่ม "main": "electron/main.cjs" ใน package.json และเพิ่ม script:
   "electron:dev": "electron .",
   "electron:build": "npm run build && electron-builder --win"
3. รัน npm run electron:build เพื่อสร้างไฟล์ติดตั้ง .exe ในโฟลเดอร์ dist/
`
  );

  zip.file(
    'README-วิธีใช้งาน.txt',
    `FlowTrend IQ — โปรแกรมช่วยหากราฟเทรนด์ไหล 1 นาที สำหรับ IQ Option (Binary & Digital)
รองรับการติดตั้งเป็นแอปบนมือถือ Android และเครื่องคอมพิวเตอร์ PC

วิธีติดตั้งเป็นแอปบนเครื่อง PC (Windows):
1. ติดตั้ง Node.js เวอร์ชัน 20 ขึ้นไป (ดาวน์โหลดจาก https://nodejs.org)
2. แตกไฟล์ ZIP นี้ไปยังโฟลเดอร์ถาวร (เช่น C:\\FlowTrend-IQ)
3. ดับเบิลคลิกไฟล์ Install-FlowTrend-IQ-Windows.bat เพียงครั้งเดียว
   - ระบบจะสร้างไอคอนโปรแกรม "FlowTrend IQ" ไว้บนหน้าจอ Desktop ให้อัตโนมัติ
   - ครั้งต่อไปดับเบิลคลิกไอคอนบน Desktop เพื่อเปิดโปรแกรมเป็นหน้าต่างแอปแยกอิสระได้ทันที

วิธีติดตั้งเป็นแอปบนมือถือ Android:
1. เปิดเว็บแอป FlowTrend IQ ด้วย Google Chrome บนมือถือ Android
2. กดปุ่ม "ติดตั้งเป็นแอปลงเครื่อง" ในหน้าโปรแกรม (หรือเมนู ⋮ -> ติดตั้งแอป)
3. Android จะสร้างไอคอน FlowTrendIQ ไว้ในหน้าหลักและ App Drawer เปิดใช้งานได้ทันทีเหมือนแอปทั่วไป

หมายเหตุ:
- โปรแกรมนี้เป็นโปรแกรมช่วยสแกนหาจุดเข้าและส่งเสียง/สั่นแจ้งเตือนแบบเรียลไทม์เท่านั้น ผู้ใช้งานจะเป็นคนกดออเดอร์ด้วยตัวเองบน IQ Option
`
  );

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
