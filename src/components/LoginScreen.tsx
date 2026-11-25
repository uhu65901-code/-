import React, { useState } from 'react';
import { Download, Eye, EyeOff, KeyRound, Mail, Play, ShieldCheck, Smartphone } from 'lucide-react';
import { ConnectionMode, ScannerConfig } from '../lib/types';
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
}

interface LoginScreenProps {
  onAuthenticated: (payload: AuthSuccessPayload) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onAuthenticated }) => {
  const [authTab, setAuthTab] = useState<'credentials' | 'ssid'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ssid, setSsid] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [requires2FA, setRequires2FA] = useState(false);
  const [twoFactorToken, setTwoFactorToken] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDownloadModal, setShowDownloadModal] = useState(false);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    unlockAudioContext();

    if (requires2FA) {
      if (twoFactorCode.trim().length < 4) {
        setError('กรุณากรอกรหัสยืนยัน 2FA ให้ครบถ้วน');
        return;
      }
      setLoading(true);
      try {
        const res = await fetch('/api/auth/verify-2fa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            twoFactorToken,
            code: twoFactorCode.trim(),
            email,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'ยืนยัน 2FA ไม่สำเร็จ');
          return;
        }
        onAuthenticated(data);
      } catch {
        setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
      } finally {
        setLoading(false);
      }
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

    setLoading(true);
    try {
      const payload =
        authTab === 'credentials'
          ? { mode: 'IQ_CREDENTIALS', email: email.trim(), password }
          : { mode: 'IQ_SSID', ssid: ssid.trim(), email: email.trim() };

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (res.status === 202 && data.requires2FA) {
        setRequires2FA(true);
        setTwoFactorToken(data.twoFactorToken);
        return;
      }

      if (!res.ok) {
        setError(data.error || 'เข้าสู่ระบบไม่สำเร็จ');
        return;
      }

      onAuthenticated(data);
    } catch {
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่');
    } finally {
      setLoading(false);
    }
  };

  const handleStartDemo = async () => {
    setError(null);
    unlockAudioContext();
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'DEMO',
          email: email.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'ไม่สามารถเริ่มโหมดทดสอบได้');
        return;
      }
      onAuthenticated(data);
    } catch {
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    } finally {
      setLoading(false);
    }
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
                เพื่อตรวจจับเทรนด์ไหลต่อเนื่อง 5–6 แท่ง แท่งสั้นสม่ำเสมอ ไส้น้อยมาก และแจ้งเตือนเสียงดังชัดเจน
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
                    5–6 แท่ง (สีเดียวกัน ไส้น้อย ไม่สวิง)
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
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-[#F8FAFC]">
              เชื่อมต่อบัญชี IQ Option
            </h2>
            <p className="mt-1 text-xs text-[#94A3B8]">
              เข้าสู่ระบบด้วย Gmail และรหัสผ่านของ IQ Option เพื่อดึงกราฟตรงกับโบรกเกอร์
            </p>
          </div>

          {!requires2FA && (
            <div className="grid grid-cols-2 gap-1 p-1 bg-[#0B111E] border border-[#1D273B] rounded-lg mb-6">
              <button
                type="button"
                onClick={() => {
                  setAuthTab('credentials');
                  setError(null);
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
              <div>
                <label
                  htmlFor="iq-ssid"
                  className="block text-xs font-medium text-[#CBD5E1] mb-1.5"
                >
                  IQ Option Cookie SSID
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
            )}

            {error && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300 leading-relaxed"
              >
                {error}
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

          <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-[#64748B]">
            <Smartphone className="w-3.5 h-3.5 text-[#60A5FA]" />
            <span>รองรับทั้งมือถือ Android (PWA เต็มจอ) และคอมพิวเตอร์ PC</span>
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
