import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

function addDirectoryRecursive(
  zip: JSZip,
  absDir: string,
  zipRelDir: string
) {
  if (!fs.existsSync(absDir)) return;
  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'assets' && zipRelDir.endsWith('src')) {
      continue;
    }
    const fullPath = path.join(absDir, entry.name);
    const targetZipPath = path.posix.join(zipRelDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'aistudio') continue;
      addDirectoryRecursive(zip, fullPath, targetZipPath);
    } else if (entry.isFile()) {
      zip.file(targetZipPath, fs.readFileSync(fullPath));
    }
  }
}

function ensureBuiltArtifacts() {
  const rootDir = process.cwd();
  const runtimePath = path.join(rootDir, 'dist-standalone', 'runtime.cjs');
  const htmlAppPath = path.join(rootDir, 'dist-standalone', 'FlowTrend-IQ-App.html');
  const distIndexPath = path.join(rootDir, 'dist', 'index.html');

  if (!fs.existsSync(distIndexPath)) {
    execSync('npm run build', { cwd: rootDir, stdio: 'pipe' });
  } else if (!fs.existsSync(runtimePath) || !fs.existsSync(htmlAppPath)) {
    execSync('node scripts/build-standalone.mjs', { cwd: rootDir, stdio: 'pipe' });
  }
}

export async function buildStandaloneAppHtmlBuffer(): Promise<Buffer> {
  ensureBuiltArtifacts();
  const htmlAppPath = path.join(process.cwd(), 'dist-standalone', 'FlowTrend-IQ-App.html');
  return fs.readFileSync(htmlAppPath);
}

export async function buildProgramZipBuffer(): Promise<Buffer> {
  ensureBuiltArtifacts();

  const zip = new JSZip();
  const rootDir = process.cwd();
  const runtimePath = path.join(rootDir, 'dist-standalone', 'runtime.cjs');
  const distDir = path.join(rootDir, 'dist');

  // Pre-compiled runtime & UI only (ZERO source code attached)
  zip.file('app/runtime.cjs', fs.readFileSync(runtimePath));
  addDirectoryRecursive(zip, distDir, 'app/ui');

  // Windows 1-click installer: installs into %LOCALAPPDATA%\FlowTrend-IQ, creates Desktop icon & launches app window
  zip.file(
    'Install-FlowTrend-IQ.bat',
    `@echo off
setlocal
cd /d "%~dp0"
title Installing FlowTrend IQ
echo ========================================================
echo   FlowTrend IQ - Standalone PC Installer (No Source)
echo ========================================================

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo Node.js runtime not found. Installing Node.js LTS automatically...
  where winget >nul 2>nul
  if %ERRORLEVEL% EQU 0 (
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreement
    set "PATH=%ProgramFiles%\\nodejs;%PATH%"
  )
)

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [!] Please install Node.js LTS once from https://nodejs.org then double-click this file again.
  pause
  exit /b 1
)

set "TARGET=%LOCALAPPDATA%\\FlowTrend-IQ"
echo [1/3] Installing application files to "%TARGET%"...
if not exist "%TARGET%" mkdir "%TARGET%"
xcopy /E /I /Y "%~dp0app" "%TARGET%\\app" >nul

echo [2/3] Creating silent app launcher...
(
  echo Set WshShell = CreateObject^("WScript.Shell"^)
  echo Set fso = CreateObject^("Scripting.FileSystemObject"^)
  echo WshShell.CurrentDirectory = "%TARGET%"
  echo WshShell.Run "cmd /c set PORT=3847&& node ""%TARGET%\\app\\runtime.cjs""", 0, False
  echo WScript.Sleep 1800
  echo On Error Resume Next
  echo Err.Clear
  echo WshShell.Run "msedge --app=http://127.0.0.1:3847", 1, False
  echo If Err.Number ^<^> 0 Then
  echo   Err.Clear
  echo   WshShell.Run "chrome --app=http://127.0.0.1:3847", 1, False
  echo   If Err.Number ^<^> 0 Then
  echo     WshShell.Run "http://127.0.0.1:3847", 1, False
  echo   End If
  echo End If
) > "%TARGET%\\Launch-FlowTrend-IQ.vbs"

echo [3/3] Creating Desktop and Start Menu icon "FlowTrend IQ"...
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) { $s = $ws.CreateShortcut($dir + '\\FlowTrend IQ.lnk'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%TARGET%\\Launch-FlowTrend-IQ.vbs\"'; $s.WorkingDirectory = '%TARGET%'; if (Test-Path '%TARGET%\\app\\ui\\favicon.ico') { $s.IconLocation = '%TARGET%\\app\\ui\\favicon.ico' }; $s.Save() }"

echo.
echo ========================================================
echo   Installed! Click "FlowTrend IQ" icon on Desktop anytime.
echo   Launching FlowTrend IQ now...
echo ========================================================
start "" wscript.exe "%TARGET%\\Launch-FlowTrend-IQ.vbs"
timeout /t 2 /nobreak >nul
`
  );

  // macOS 1-click launcher
  zip.file(
    'Install-FlowTrend-IQ-Mac.command',
    `#!/bin/bash
set -e
cd "$(dirname "$0")"
PORT=3847 node app/runtime.cjs &
SERVER_PID=$!
sleep 2
if open -Ra "Google Chrome" 2>/dev/null; then
  open -na "Google Chrome" --args --app=http://127.0.0.1:3847
else
  open http://127.0.0.1:3847
fi
wait $SERVER_PID
`
  );

  zip.file(
    'วิธีติดตั้งใช้งาน.txt',
    `FlowTrend IQ — โปรแกรมช่วยสแกนกราฟเทรนด์ไหล 1 นาที (ทำงานอิสระในเครื่อง ไม่ต้องพึ่ง AI Studio)

วิธีติดตั้งบนเครื่อง PC (Windows):
1. แตกไฟล์ ZIP นี้ แล้วดับเบิลคลิกไฟล์ Install-FlowTrend-IQ.bat
2. ระบบจะติดตั้งโปรแกรมลงเครื่องและสร้างไอคอน "FlowTrend IQ" ไว้ที่หน้าจอ Desktop และ Start Menu ให้อัตโนมัติ
3. หลังจากนั้นดับเบิลคลิกที่ไอคอน "FlowTrend IQ" บน Desktop เพื่อเปิดใช้งานได้ทันที (ลบไฟล์ ZIP ที่โหลดมาทิ้งได้เลย)

วิธีใช้งานบนมือถือ Android (ไม่ต้องพึ่ง AI Studio):
- วิธีที่ 1: เปิดแอปผ่าน Chrome แล้วกดปุ่ม "ติดตั้งเป็นแอปลงเครื่อง" เพื่อสร้างไอคอน FlowTrendIQ บนหน้าหลักมือถือ
- วิธีที่ 2: ดาวน์โหลดไฟล์ FlowTrend-IQ-App.html จากปุ่มดาวน์โหลดสำหรับ Android แล้วแตะเปิดไฟล์นั้นเพื่อใช้งานได้ทันทีโดยไม่ต้องพึ่งเซิร์ฟเวอร์
`
  );

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
