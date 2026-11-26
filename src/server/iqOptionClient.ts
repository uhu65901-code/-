import WebSocket from 'ws';
import type { AssetInfo, Candle } from '../lib/types.ts';
import { IQ_OPTION_ASSETS } from './assetsCatalog.ts';

export type IqLoginResult =
  | { status: 'OK'; ssid: string; email: string }
  | { status: '2FA_REQUIRED'; token: string; method?: string }
  | { status: 'INVALID_CREDENTIALS'; message: string }
  | { status: 'BLOCKED_OR_CHALLENGE'; message: string }
  | { status: 'ERROR'; message: string };

function extractSsidFromHeaders(headers: Headers, body: Record<string, unknown>): string | null {
  if (typeof body?.ssid === 'string' && body.ssid.length > 8) {
    return body.ssid;
  }
  const setCookie = headers.get('set-cookie');
  if (setCookie) {
    const match = setCookie.match(/ssid=([^;]+)/);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

export async function loginWithIqOption(
  email: string,
  password: string
): Promise<IqLoginResult> {
  try {
    const response = await fetch('https://auth.iqoption.com/api/v2/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'application/json',
        Origin: 'https://iqoption.com',
        Referer: 'https://iqoption.com/',
      },
      body: JSON.stringify({
        identifier: email.trim(),
        password,
      }),
      signal: AbortSignal.timeout(12000),
    });

    const rawText = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(rawText);
    } catch {
      data = {};
    }

    if (response.status === 200) {
      if (data.code === 'two_factor_auth' && typeof data.token === 'string') {
        return {
          status: '2FA_REQUIRED',
          token: data.token,
          method: typeof data.method === 'string' ? data.method : 'sms',
        };
      }

      const ssid = extractSsidFromHeaders(response.headers, data);
      if (ssid) {
        return { status: 'OK', ssid, email: email.trim() };
      }
      return {
        status: 'ERROR',
        message: 'ล็อกอินสำเร็จแต่ไม่พบ Session SSID จาก IQ Option',
      };
    }

    if (response.status === 401 || data.code === 'invalid_credentials') {
      return {
        status: 'INVALID_CREDENTIALS',
        message: 'อีเมลหรือรหัสผ่าน IQ Option ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
      };
    }

    if (response.status === 403 || response.status === 429) {
      return {
        status: 'BLOCKED_OR_CHALLENGE',
        message:
          'IQ Option ติดการตรวจสอบความปลอดภัย (Captcha/Cloudflare) จากเซิร์ฟเวอร์ สามารถระบุ SSID Token โดยตรง หรือเข้าใช้งานโหมดทดสอบสดได้ทันที',
      };
    }

    return {
      status: 'ERROR',
      message:
        typeof data.message === 'string'
          ? data.message
          : `IQ Option ตอบกลับสถานะ ${response.status}`,
    };
  } catch (err) {
    const isTimeout =
      err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return {
      status: 'ERROR',
      message: isTimeout
        ? 'เซิร์ฟเวอร์ IQ Option ตอบสนองช้าเกินไป กรุณาลองใหม่หรือใช้ Session SSID'
        : err instanceof Error
          ? `ไม่สามารถเชื่อมต่อ IQ Option ได้: ${err.message}`
          : 'เกิดข้อผิดพลาดในการเชื่อมต่อ IQ Option',
    };
  }
}

export async function verifyIqOption2FA(
  token: string,
  code: string
): Promise<IqLoginResult> {
  try {
    const response = await fetch('https://auth.iqoption.com/api/v2/verify/2fa', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: 'https://iqoption.com',
        Referer: 'https://iqoption.com/',
      },
      body: JSON.stringify({
        token,
        code: code.trim(),
      }),
      signal: AbortSignal.timeout(12000),
    });

    const rawText = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(rawText);
    } catch {
      data = {};
    }

    if (response.status === 200) {
      const ssid = extractSsidFromHeaders(response.headers, data);
      if (ssid) {
        return { status: 'OK', ssid, email: '' };
      }
    }

    return {
      status: 'INVALID_CREDENTIALS',
      message: 'รหัสยืนยัน 2FA ไม่ถูกต้องหรือหมดอายุ',
    };
  } catch (err) {
    return {
      status: 'ERROR',
      message:
        err instanceof Error
          ? `ตรวจสอบ 2FA ไม่สำเร็จ: ${err.message}`
          : 'ตรวจสอบ 2FA ไม่สำเร็จ',
    };
  }
}

function cleanBrokerAssetName(rawName: string): string {
  // IQ Option returns e.g. "front.EURUSD-OTC" or "front.SATSUSD-OTC" or "EURUSD"
  return rawName.replace(/^front\./i, '').trim();
}

export class IqLiveFeedConnection {
  private ws: WebSocket | null = null;
  private ssid: string;
  private reqCounter = 1;
  private onCandlesUpdate: (assetId: string, candles: Candle[]) => void;
  private onCandleTick: (assetId: string, candle: Candle) => void;
  private onStatus: (connected: boolean, message?: string) => void;
  private onAssetsDiscovered?: (assets: AssetInfo[]) => void;

  private activeIdToAssetId = new Map<number, string>();
  private discoveredAssets = new Map<string, AssetInfo>();
  private subscribedActiveIds = new Set<number>();
  private reqIdToAssetId = new Map<string, string>();
  private closedByCaller = false;

  constructor(
    ssid: string,
    callbacks: {
      onCandlesUpdate: (assetId: string, candles: Candle[]) => void;
      onCandleTick: (assetId: string, candle: Candle) => void;
      onStatus: (connected: boolean, message?: string) => void;
      onAssetsDiscovered?: (assets: AssetInfo[]) => void;
    }
  ) {
    this.ssid = ssid;
    this.onCandlesUpdate = callbacks.onCandlesUpdate;
    this.onCandleTick = callbacks.onCandleTick;
    this.onStatus = callbacks.onStatus;
    this.onAssetsDiscovered = callbacks.onAssetsDiscovered;

    for (const a of IQ_OPTION_ASSETS) {
      this.activeIdToAssetId.set(a.iqActiveId, a.id);
    }
  }

  getDiscoveredAssets(): AssetInfo[] {
    return Array.from(this.discoveredAssets.values());
  }

  connect() {
    this.closedByCaller = false;
    try {
      this.ws = new WebSocket('wss://iqoption.com/echo/websocket');
    } catch (err) {
      this.onStatus(false, err instanceof Error ? err.message : 'WS Init Failed');
      return;
    }

    this.ws.on('open', () => {
      this.send({ name: 'ssid', msg: this.ssid });
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.name === 'profile' && msg.msg) {
          this.onStatus(true, 'เชื่อมต่อ IQ Option สดสำเร็จ กำลังดึงสินทรัพย์ 1 นาทีทั้งหมด...');
          this.requestAllTradableInstruments();
        } else if (msg.name === 'ssid' && msg.msg === false) {
          this.onStatus(false, 'Session SSID ไม่ถูกต้องหรือหมดอายุ');
        } else if (msg.name === 'initialization-data' && msg.msg) {
          this.handleBinaryInitData(msg.msg);
        } else if (
          msg.name === 'underlying-list' &&
          msg.msg &&
          Array.isArray(msg.msg.underlying)
        ) {
          this.handleDigitalUnderlyingList(msg.msg.underlying);
        } else if (msg.name === 'candles' && msg.msg?.candles && msg.request_id) {
          const assetId = this.reqIdToAssetId.get(String(msg.request_id));
          if (assetId && Array.isArray(msg.msg.candles)) {
            const parsed: Candle[] = msg.msg.candles.map(
              (c: {
                from: number;
                open: number;
                max: number;
                min: number;
                close: number;
                volume?: number;
              }) => ({
                time: Number(c.from),
                open: Number(c.open),
                high: Number(c.max),
                low: Number(c.min),
                close: Number(c.close),
                volume: c.volume ? Number(c.volume) : 0,
              })
            );
            this.onCandlesUpdate(assetId, parsed);
          }
        } else if (msg.name === 'candle-generated' && msg.msg) {
          const c = msg.msg;
          const assetId = this.activeIdToAssetId.get(Number(c.active_id));
          if (assetId && Number(c.size) === 60) {
            this.onCandleTick(assetId, {
              time: Number(c.from),
              open: Number(c.open),
              high: Number(c.max),
              low: Number(c.min),
              close: Number(c.close),
              volume: c.volume ? Number(c.volume) : 0,
            });
          }
        }
      } catch {
        // ignore malformed frames
      }
    });

    this.ws.on('close', () => {
      if (!this.closedByCaller) {
        this.onStatus(false, 'การเชื่อมต่อ IQ Option WebSocket ถูกตัด');
      }
    });

    this.ws.on('error', () => {
      if (!this.closedByCaller) {
        this.onStatus(false, 'เกิดข้อผิดพลาดในการสตรีม IQ Option');
      }
    });
  }

  private requestAllTradableInstruments() {
    // Request Binary / Turbo 1-minute initialization data
    this.send({
      name: 'sendMessage',
      request_id: `init_binary_${this.reqCounter++}`,
      msg: {
        name: 'get-initialization-data',
        version: '3.0',
        body: {},
      },
    });

    // Request Digital 1-minute underlying list
    this.send({
      name: 'sendMessage',
      request_id: `init_digital_${this.reqCounter++}`,
      msg: {
        name: 'digital-option-instruments.get-underlying-list',
        version: '1.0',
        body: { filter_suspended: true },
      },
    });

    // Also subscribe baseline catalog immediately so data starts flowing right away
    this.subscribeBatch(
      IQ_OPTION_ASSETS.map((a) => ({
        id: a.id,
        iqActiveId: a.iqActiveId,
        name: a.name,
        symbol: a.symbol,
        category: a.category,
        isOtc: a.isOtc,
        payoutPercent: a.payoutPercent,
        decimals: a.decimals,
      }))
    );
  }

  private handleBinaryInitData(msgBody: Record<string, unknown>) {
    const groups = [
      (msgBody.turbo as { actives?: Record<string, Record<string, unknown>> } | undefined)
        ?.actives,
      (msgBody.binary as { actives?: Record<string, Record<string, unknown>> } | undefined)
        ?.actives,
    ];

    const newlyDiscovered: AssetInfo[] = [];

    for (const actives of groups) {
      if (!actives || typeof actives !== 'object') continue;
      for (const active of Object.values(actives)) {
        if (!active || !active.enabled || active.is_suspended) continue;
        const activeId = Number(active.id);
        if (!Number.isFinite(activeId) || activeId <= 0) continue;

        const rawName = String(active.name || active.ticker || `ACTIVE-${activeId}`);
        const cleanName = cleanBrokerAssetName(rawName);
        const ticker = String(active.ticker || cleanName);
        const precision = Math.min(8, Math.max(2, Number(active.precision ?? 5)));
        const commission = Number((active.option as { profit?: { commission?: number } } | undefined)?.profit?.commission ?? 16);
        const payoutPercent = Math.max(50, Math.min(98, 100 - commission));
        const isOtc = /otc/i.test(cleanName) || /otc/i.test(ticker);

        const assetId = `iq-${activeId}`;
        const info: AssetInfo = {
          id: assetId,
          iqActiveId: activeId,
          name: cleanName,
          symbol: ticker,
          category: 'BINARY',
          isOtc,
          payoutPercent,
          decimals: precision,
        };

        this.activeIdToAssetId.set(activeId, assetId);
        this.discoveredAssets.set(assetId, info);
        newlyDiscovered.push(info);
      }
    }

    if (newlyDiscovered.length > 0) {
      this.subscribeBatch(newlyDiscovered);
      this.onAssetsDiscovered?.(this.getDiscoveredAssets());
      this.onStatus(
        true,
        `เชื่อมต่อ IQ Option สด · สแกนพร้อมกัน ${this.discoveredAssets.size} คู่ (1 นาที)`
      );
    }
  }

  private handleDigitalUnderlyingList(underlyings: Array<Record<string, unknown>>) {
    const newlyDiscovered: AssetInfo[] = [];

    for (const item of underlyings) {
      if (!item || item.is_suspended) continue;
      const activeId = Number(item.active_id);
      if (!Number.isFinite(activeId) || activeId <= 0) continue;

      // Only include instruments supporting 60s (1-minute) expiration
      const schedule = Array.isArray(item.schedule) ? item.schedule : [];
      const cleanName = cleanBrokerAssetName(String(item.name || item.underlying || `DIG-${activeId}`));
      const isOtc = /otc/i.test(cleanName);
      const assetId = `iq-${activeId}`;

      if (!this.discoveredAssets.has(assetId)) {
        const info: AssetInfo = {
          id: assetId,
          iqActiveId: activeId,
          name: cleanName,
          symbol: cleanName,
          category: 'DIGITAL',
          isOtc,
          payoutPercent: 85,
          decimals: schedule.length > 0 ? 5 : 5,
        };
        this.activeIdToAssetId.set(activeId, assetId);
        this.discoveredAssets.set(assetId, info);
        newlyDiscovered.push(info);
      }
    }

    if (newlyDiscovered.length > 0) {
      this.subscribeBatch(newlyDiscovered);
      this.onAssetsDiscovered?.(this.getDiscoveredAssets());
      this.onStatus(
        true,
        `เชื่อมต่อ IQ Option สด · สแกนพร้อมกัน ${this.discoveredAssets.size} คู่ (Binary & Digital 1m)`
      );
    }
  }

  private subscribeBatch(assets: AssetInfo[]) {
    const nowSec = Math.floor(Date.now() / 1000);
    assets.forEach((asset, idx) => {
      if (this.subscribedActiveIds.has(asset.iqActiveId)) return;
      this.subscribedActiveIds.add(asset.iqActiveId);

      // Gentle stagger in small chunks (every 12 instruments = +60ms) so WS stays fluid
      const delayMs = Math.floor(idx / 12) * 60;
      setTimeout(() => {
        if (this.closedByCaller || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
          return;
        }
        const reqId = `candles_${this.reqCounter++}`;
        this.reqIdToAssetId.set(reqId, asset.id);
        this.send({
          name: 'sendMessage',
          request_id: reqId,
          msg: {
            name: 'get-candles',
            version: '2.0',
            body: {
              active_id: asset.iqActiveId,
              size: 60,
              to: nowSec,
              count: 55,
            },
          },
        });
        this.send({
          name: 'subscribeMessage',
          msg: {
            name: 'candle-generated',
            params: {
              routingFilters: {
                active_id: asset.iqActiveId,
                size: 60,
              },
            },
          },
        });
      }, delayMs);
    });
  }

  private send(payload: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  disconnect() {
    this.closedByCaller = true;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }
}
