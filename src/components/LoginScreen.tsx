import React, { useCallback, useEffect, useState } from 'react';
import {
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  Play,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import {
  loadSavedConfig,
  loadSavedSsid,
  saveSsidLocally,
} from '../lib/standaloneStorage';
import { ConnectionMode, ScannerConfig } from '../lib/types';
import { checkServerHealth, postJsonWithRetry, ServerHealthStatus } from '../utils/apiClient';
import { unlockAudioContext } from '../utils/soundAlert';
import { DownloadInstallModal } from './DownloadInstallModal';
import { OfflineIndicator, PWAInstallButton } from './PWAInstallButton';

export interface AuthSuccessPayload {
  token: string;
  email: string;
  mode: ConnectionMode;
  iqConnected: boolean;
  iqStatusMessage?: string;
  scanningActive: boolean;
  config: ScannerConfig;
  ssid?: string;
}

interface LoginScreenProps {
  onAuthenticated: (payload: AuthSuccessPayload) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onAuthenticated }) => {
  const [authTab, setAuthTab] = useState<'credentials' | 'ssid'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ssid, setSsid] = useState(() => loadSavedSsid());
  const [rememberSsid, setRememberSsid] = useState(() => Boolean(loadSavedSsid()));
  const [showPassword, setShowPassword] = useState(false);

  const [requires2FA, setRequires2FA] = useState(false);
  const [twoFactorToken, setTwoFactorToken] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [standalonePrompt, setStandalonePrompt] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerHealthStatus>('checking');

  const isFileOrPortable =
    typeof window !== 'undefined' &&
    (window.location.protocol === 'file:' || window.location.protocol === 'content:');

  const probeServer = useCallback(async () => {
    if (isFileOrPortable) {
      setServerStatus('unreachable');
      return;
    }
    setServerStatus('checking');
    const st = await checkServerHealth();
    setServerStatus(st);
  }, [isFileOrPortable]);

  useEffect(() => {
    probeServer();
  }, [probeServer]);

  const startLocalDemoFallback = useCallback(() => {
    onAuthenticated({
      token: `local-demo-${Date.now()}`,
      email: email.trim() || 'standalone@flowtrend.local',
      mode: 'LOCAL_DEMO_STREAM',
      iqConnected: false,
      iqStatusMessage: 'โหมดสแกนทำงานอิสระในเครื่อง (ไม่ต้องพึ่งเซิร์ฟเวอร์)',
      scanningActive: true,
      config: loadSavedConfig(),
    });
  }, [email, onAuthenticated]);

  const startBrowserSsidDirect = useCallback(
    (cleanSsid: string) => {
      if (rememberSsid) {
        saveSsidLocally(cleanSsid);
      } else {
        saveSsidLocally('');
      }
      onAuthenticated({
        token: `browser-iq-${Date.now()}`,
        email: email.trim() || 'iq-direct-session',
        mode: 'IQ_BROWSER_LIVE',
        iqConnected: true,
        iqStatusMessage: 'กำลังเชื่อม IQ Option โดยตรงจากในเครื่อง...',
        scanningActive: true,
        config: loadSavedConfig(),
        ssid: cleanSsid,
      });
    },
    [email, onAuthenticated, rememberSsid]
  );

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStandalonePrompt(false);
    unlockAudioContext();

    if (requires2FA) {
      if (twoFactorCode.trim().length < 4) {
        setError('กรุณากรอกรหัสยืนยัน 2FA ให้ครบถ้วน');
        return;
      }
      setLoading(true);
      const res = await postJsonWithRetry<AuthSuccessPayload>('/api/auth/verify-2fa', {
        twoFactorToken,
        code: twoFactorCode.trim(),
        email,
      });
      setLoading(false);

      if (res.ok) {
        onAuthenticated(res.data);
        return;
      }

      if (res.kind !== 'http_error') {
        setStandalonePrompt(true);
        probeServer();
      }
      setError(res.message);
      return;
    }

    if (authTab === 'credentials') {
      if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        setError('กรุณากรอกอีเมล (Gmail) ที่ใช้กับ IQ Option ให้ถูกต้อง');
        return;
      }
      if (!password || password.length < 4) {
        setError('กรุณากรอกรหัสผ่านอย่างน้อย 4 ตัวอักษร');
        return;
      }
    } else {
      if (!ssid.trim() || ssid.trim().length < 10) {
        setError('กรุณาระบุ Session SSID อย่างน้อย 10 ตัวอักษร');
        return;
      }
    }

    // In portable / standalone mode without backend server, SSID connects directly via browser WebSocket
    if (authTab === 'ssid' && (isFileOrPortable || serverStatus !== 'ready')) {
      if (rememberSsid) {
        saveSsidLocally(ssid.trim());
      } else {
        saveSsidLocally('');
      }
      startBrowserSsidDirect(ssid.trim());
      return;
    }

    // If credentials mode and already known to be offline/serverless, immediately guide user without failing with 404
    if (authTab === 'credentials' && (isFileOrPortable || (serverStatus !== 'ready' && serverStatus !== 'checking'))) {
      setStandalonePrompt(true);
      setError(
        'โหมดอิสระในเครื่อง (ไม่พึ่ง AI Studio) ไม่สามารถส่ง Gmail/รหัสผ่านตรงผ่านเบราว์เซอร์ได้ — กรุณาใช้แท็บ Session SSID เพื่อเชื่อม IQ Option สด หรือเปิดผ่านตัวติดตั้ง PC'
      );
      return;
    }

    setLoading(true);
    const payload =
      authTab === 'credentials'
        ? { mode: 'IQ_CREDENTIALS', email: email.trim(), password }
        : { mode: 'IQ_SSID', ssid: ssid.trim(), email: email.trim() };

    const res = await postJsonWithRetry<
      AuthSuccessPayload & { requires2FA?: boolean; twoFactorToken?: string }
    >('/api/auth/login', payload, 2);
    setLoading(false);

    if (res.ok) {
      if (res.status === 202 && res.data.requires2FA && res.data.twoFactorToken) {
        setRequires2FA(true);
        setTwoFactorToken(res.data.twoFactorToken);
        return;
      }
      if (authTab === 'ssid') {
        saveSsidLocally(rememberSsid ? ssid.trim() : '');
      }
      onAuthenticated(res.data);
      return;
    }

    if (res.kind !== 'http_error') {
      if (authTab === 'ssid') {
        startBrowserSsidDirect(ssid.trim());
        return;
      }
      setStandalonePrompt(true);
      probeServer();
      setError(
        'ขณะนี้กำลังเปิดใช้งานแบบไม่พึ่งเซิร์ฟเวอร์ AI Studio — สามารถสลับใช้แท็บ Session SSID เพื่อเชื่อม IQ Option โดยตรง, ใช้โหมด Demo ในเครื่อง, หรือโหลดตัวติดตั้ง PC ได้ทันที'
      );
      return;
    }
    setError(res.message);
  };

  const handleStartDemo = async () => {
    setError(null);
    setStandalonePrompt(false);
    unlockAudioContext();

    if (isFileOrPortable || serverStatus !== 'ready') {
      startLocalDemoFallback();
      return;
    }

    setLoading(true);
    const res = await postJsonWithRetry<AuthSuccessPayload>(
      '/api/auth/login',
      {
        mode: 'DEMO',
        email: email.trim() || undefined,
      },
      1
    );
    setLoading(false);

    if (res.ok) {
      onAuthenticated(res.data);
      return;
    }

    startLocalDemoFallback();
  };

  return (
    <div className="min-h-screen bg-[#0B111E] text-[#E6ECF5] flex items-center justify-center p-4 lg:p-8">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 border border-[#1D273B] bg-[#0D1422] rounded-xl overflow-hidden">
        {/* Left Informational Panel */}
        <div className="lg:col-span-6 p-6 lg:p-10 border-b lg:border-b-0 lg:border-r border-[#1D273B] flex flex-col justify-between gap-8 bg-[#0B111E]">
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-[#60A5FA] text-balance">
                โปรแกรมช่วยหากราฟ FlowTrend IQ (1 นาที)
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-[#94A3B8]">
                สแกนคู่สินทรัพย์ Binary และ Digital บน IQ Option พร้อมกันทั้งหมด (ทั้งตลาด OTC และตลาดปกติ)
                เพื่อตรวจจับเทรนด์ไหลต่อเนื่อง 4–6 แท่งล่าสุด แท่งเล็กสม่ำเสมอ สีเดียวกัน ไม่สวิง และแจ้งเตือนแบบเรียลไทม์ทันที
              </p>
            </div>

            <div className="space-y-4 pt-2 border-t border-[#1A2438]">
              <h2 className="text-xs font-semibold tracking-wide text-[#CBD5E1]">
                คุณสมบัติหลักของตัวสแกน
              </h2>
              <ul className="space-y-3 text-sm text-[#94A3B8]">
                <li className="flex items-start justify-between gap-4 border-b border-[#141D2F] pb-2.5">
                  <span>ความยาวเทรนด์ไหล</span>
                  <span className="text-[#E2E8F0] font-medium text-right">
                    4–6 แท่งล่าสุด (แท่งเล็ก สีเดียวกัน ไม่สวิง)
                  </span>
                </li>
                <li className="flex items-start justify-between gap-4 border-b border-[#141D2F] pb-2.5">
                  <span>ความเร็วการสแกน</span>
                  <span className="text-[#E2E8F0] font-medium text-right">
                    สแกนพร้อมกันทุกคู่ 1 นาที (OTC + ปกติ)
                  </span>
                </li>
                <li className="flex items-start justify-between gap-4 border-b border-[#141D2F] pb-2.5">
                  <span>มุมมองกราฟ</span>
                  <span className="text-[#E2E8F0] font-medium text-right">
                    ดูพร้อมกันได้ 1–4 กราฟ + ซูมเข้า-ออกได้
                  </span>
                </li>
                <li className="flex items-start justify-between gap-4">
                  <span>ลักษณะการทำงาน</span>
                  <span className="text-[#16C784] font-medium text-right">
                    แจ้งเตือนอย่างเดียว ผู้ใช้กดเทรดเอง
                  </span>
                </li>
              </ul>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-[#11192B] border border-[#1E293B] text-xs text-[#94A3B8] leading-relaxed">
              <ShieldCheck className="w-4 h-4 text-[#16C784] shrink-0 mt-0.5" />
              <span>
                เมื่อเชื่อมต่อด้วย Gmail/รหัสผ่าน หรือ Session SSID ของ IQ Option ระบบจะดึงข้อมูลแท่งเทียน 1 นาทีและชื่อสินทรัพย์ตรงกับโบรกเกอร์โดยตรง และไม่บันทึกรหัสผ่านไว้ในเครื่อง
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowDownloadModal(true)}
                className="flex-1 min-w-[200px] py-2.5 px-4 text-xs font-medium rounded-lg bg-[#11192B] hover:bg-[#19243D] border border-[#23304A] text-[#CBD5E1] flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4 text-[#60A5FA]" />
                <span>ดาวน์โหลด / ติดตั้ง (Android &amp; PC)</span>
              </button>
              <PWAInstallButton />
            </div>
          </div>
        </div>

        {/* Right Authentication Form */}
        <div className="lg:col-span-6 p-6 lg:p-10 flex flex-col justify-center">
          <div className="mb-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-[#F8FAFC]">
                เชื่อมต่อบัญชี IQ Option
              </h2>

              <button
                type="button"
                onClick={probeServer}
                className="inline-flex items-center gap-1.5 text-[11px] text-[#94A3B8] hover:text-[#E2E8F0] cursor-pointer"
                title="สถานะการทำงานของระบบ"
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    serverStatus === 'ready'
                      ? 'bg-[#16C784]'
                      : serverStatus === 'checking'
                        ? 'bg-amber-400 animate-pulse'
                        : 'bg-[#60A5FA]'
                  }`}
                />
                <span>
                  {serverStatus === 'ready'
                    ? 'พร้อมใช้งาน (ออนไลน์)'
                    : serverStatus === 'checking'
                      ? 'กำลังตรวจสอบระบบ...'
                      : 'โหมดอิสระในเครื่อง (พร้อมใช้งาน)'}
                </span>
              </button>
            </div>
            <p className="mt-1 text-xs text-[#94A3B8]">
              {serverStatus === 'ready'
                ? 'เข้าสู่ระบบด้วย Gmail/รหัสผ่าน หรือ Session SSID ของ IQ Option เพื่อดึงกราฟตรงกับโบรกเกอร์'
                : 'ทำงานอิสระในเครื่องได้ทันที (เชื่อม IQ Option สดผ่าน Session SSID หรือสแกน Demo ในเครื่อง)'}
            </p>
          </div>

          {!requires2FA && (
            <div className="grid grid-cols-2 gap-1 p-1 bg-[#0B111E] border border-[#1D273B] rounded-lg mb-6">
              <button
                type="button"
                onClick={() => {
                  setAuthTab('credentials');
                  setError(null);
                  setStandalonePrompt(false);
                }}
                className={`py-2 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  authTab === 'credentials'
                    ? 'bg-[#1D2A42] text-[#F8FAFC]'
                    : 'text-[#94A3B8] hover:text-[#E2E8F0]'
                }`}
              >
                Gmail &amp; รหัสผ่าน
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthTab('ssid');
                  setError(null);
                  setStandalonePrompt(false);
                }}
                className={`py-2 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  authTab === 'ssid'
                    ? 'bg-[#1D2A42] text-[#F8FAFC]'
                    : 'text-[#94A3B8] hover:text-[#E2E8F0]'
                }`}
              >
                Session SSID
              </button>
            </div>
          )}

          <form onSubmit={handleLoginSubmit} className="space-y-4" noValidate>
            {requires2FA ? (
              <div>
                <label
                  htmlFor="iq-2fa"
                  className="block text-xs font-medium text-[#CBD5E1] mb-1.5"
                >
                  รหัสยืนยันตัวตน 2 ชั้น (2FA Code)
                </label>
                <input
                  id="iq-2fa"
                  type="text"
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                  placeholder="กรอกรหัส 6 หลักจาก SMS / Authenticator"
                  className="w-full px-3.5 py-2.5 text-sm bg-[#0B111E] border border-[#23304A] rounded-lg text-[#F8FAFC] placeholder-[#64748B] focus:outline-none focus:border-[#3B82F6] font-mono-tabular"
                />
              </div>
            ) : authTab === 'credentials' ? (
              <>
                <div>
                  <label
                    htmlFor="iq-email"
                    className="block text-xs font-medium text-[#CBD5E1] mb-1.5"
                  >
                    อีเมล IQ Option (Gmail)
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-[#64748B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="iq-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@gmail.com"
                      className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-[#0B111E] border border-[#23304A] rounded-lg text-[#F8FAFC] placeholder-[#64748B] focus:outline-none focus:border-[#3B82F6]"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="iq-password"
                    className="block text-xs font-medium text-[#CBD5E1] mb-1.5"
                  >
                    รหัสผ่าน IQ Option
                  </label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-[#64748B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="iq-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full pl-10 pr-10 py-2.5 text-sm bg-[#0B111E] border border-[#23304A] rounded-lg text-[#F8FAFC] placeholder-[#64748B] focus:outline-none focus:border-[#3B82F6]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#CBD5E1] cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="iq-ssid"
                    className="block text-xs font-medium text-[#CBD5E1] mb-1.5"
                  >
                    IQ Option Cookie SSID (เชื่อมต่อสดโดยตรง ไม่ง้อเซิร์ฟเวอร์)
                  </label>
                  <input
                    id="iq-ssid"
                    type="text"
                    value={ssid}
                    onChange={(e) => setSsid(e.target.value)}
                    placeholder="วางค่า ssid cookie จากเบราว์เซอร์ที่ล็อกอิน IQ Option แล้ว"
                    className="w-full px-3.5 py-2.5 text-sm bg-[#0B111E] border border-[#23304A] rounded-lg text-[#F8FAFC] placeholder-[#64748B] focus:outline-none focus:border-[#3B82F6] font-mono-tabular"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-[#94A3B8] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberSsid}
                    onChange={(e) => setRememberSsid(e.target.checked)}
                    className="w-3.5 h-3.5 accent-[#16C784] rounded cursor-pointer"
                  />
                  <span>จำ Session SSID ไว้ในเครื่องนี้ (เปิดแอปครั้งหน้ากดเข้าได้เลย)</span>
                </label>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className={`p-3 rounded-lg border text-xs leading-relaxed space-y-2.5 ${
                  standalonePrompt
                    ? 'bg-blue-500/10 border-blue-500/30 text-blue-100'
                    : 'bg-red-500/10 border-red-500/30 text-red-200'
                }`}
              >
                <div>{error}</div>
                {standalonePrompt && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthTab('ssid');
                        setError(null);
                        setStandalonePrompt(false);
                      }}
                      className="px-2.5 py-1.5 rounded bg-[#2563EB] hover:bg-[#3B82F6] text-white font-medium cursor-pointer"
                    >
                      สลับไปเชื่อมด้วย Session SSID
                    </button>
                    <button
                      type="button"
                      onClick={startLocalDemoFallback}
                      className="px-2.5 py-1.5 rounded bg-emerald-600/25 hover:bg-emerald-600/35 border border-emerald-500/40 text-emerald-200 font-medium inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Play className="w-3 h-3" />
                      <span>ใช้โหมดสแกน Demo ในเครื่อง</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 text-sm font-semibold rounded-lg bg-[#2563EB] hover:bg-[#3B82F6] disabled:opacity-60 text-white transition-colors cursor-pointer"
            >
              {loading
                ? 'กำลังเชื่อมต่อ...'
                : requires2FA
                  ? 'ยืนยันรหัส 2FA และเริ่มสแกน'
                  : authTab === 'ssid'
                    ? 'เชื่อมต่อ IQ Option สดทันที'
                    : 'เข้าสู่ระบบและเชื่อมต่อ IQ Option'}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#1D273B]" />
            <span className="text-xs text-[#64748B]">หรือ</span>
            <div className="h-px flex-1 bg-[#1D273B]" />
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={handleStartDemo}
            className="w-full py-2.5 px-4 text-sm font-medium rounded-lg bg-[#162033] hover:bg-[#1E2B44] border border-[#273652] text-[#E2E8F0] flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Play className="w-4 h-4 text-[#16C784]" />
            ทดลองสแกนสตรีมกราฟ 1 นาทีเรียลไทม์ (Demo Feed)
          </button>

          <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-[#64748B] text-center whitespace-nowrap">
            <Smartphone className="w-3.5 h-3.5 text-[#60A5FA] shrink-0" />
            <span>รองรับมือถือ Android (PWA) และคอมพิวเตอร์ PC</span>
          </div>
        </div>
      </div>

      <DownloadInstallModal
        open={showDownloadModal}
        onClose={() => setShowDownloadModal(false)}
      />
      <OfflineIndicator />
    </div>
  );
};
