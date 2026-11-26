import http from 'http';
import path from 'path';
import fs from 'fs';
import express, { NextFunction, Request, Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { DEFAULT_SCANNER_CONFIG, ScannerConfig } from './src/lib/types';
import { buildProgramZipBuffer } from './src/server/downloadPackage';
import { loginWithIqOption, verifyIqOption2FA } from './src/server/iqOptionClient';
import { MarketScannerEngine, UserSession } from './src/server/marketEngine';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';

const engine = new MarketScannerEngine();

interface AuthedRequest extends Request {
  userSession?: UserSession;
}

function extractBearer(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return undefined;
  return header.slice(7).trim();
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = extractBearer(req);
  const session = engine.getSession(token);
  if (!session) {
    res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งานตัวสแกน' });
    return;
  }
  req.userSession = session;
  next();
}

function clampNumber(val: unknown, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, service: 'flowtrend-iq', timestamp: Date.now() });
  });

  // Auth routes
  app.post('/api/auth/login', async (req: Request, res: Response) => {
    const { mode, email, password, ssid } = req.body ?? {};

    if (mode === 'DEMO') {
      const demoEmail =
        typeof email === 'string' && email.trim().length > 0
          ? email.trim()
          : 'practice@flowtrend.local';
      const session = engine.createSession({
        email: demoEmail,
        mode: 'DEMO_STREAM',
      });
      res.json({
        token: session.token,
        email: session.email,
        mode: session.mode,
        iqConnected: session.iqConnected,
        iqStatusMessage: session.iqStatusMessage,
        scanningActive: session.scanningActive,
        config: session.config,
      });
      return;
    }

    if (mode === 'IQ_SSID') {
      if (typeof ssid !== 'string' || ssid.trim().length < 10) {
        res.status(400).json({ error: 'กรุณาระบุ Session SSID ที่ถูกต้อง (อย่างน้อย 10 ตัวอักษร)' });
        return;
      }
      const session = engine.createSession({
        email:
          typeof email === 'string' && email.trim()
            ? email.trim()
            : 'iq-ssid-session',
        mode: 'IQ_OPTION_LIVE',
        ssid: ssid.trim(),
      });
      res.json({
        token: session.token,
        email: session.email,
        mode: session.mode,
        iqConnected: session.iqConnected,
        iqStatusMessage: session.iqStatusMessage,
        scanningActive: session.scanningActive,
        config: session.config,
      });
      return;
    }

    // Default: IQ_CREDENTIALS
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      res.status(400).json({ error: 'กรุณากรอกอีเมล (Gmail) ที่ใช้กับ IQ Option ให้ถูกต้อง' });
      return;
    }
    if (typeof password !== 'string' || password.length < 4) {
      res.status(400).json({ error: 'กรุณากรอกรหัสผ่าน IQ Option อย่างน้อย 4 ตัวอักษร' });
      return;
    }

    const result = await loginWithIqOption(email, password);

    if (result.status === 'OK') {
      const session = engine.createSession({
        email: result.email,
        mode: 'IQ_OPTION_LIVE',
        ssid: result.ssid,
      });
      res.json({
        token: session.token,
        email: session.email,
        mode: session.mode,
        iqConnected: session.iqConnected,
        iqStatusMessage: session.iqStatusMessage,
        scanningActive: session.scanningActive,
        config: session.config,
      });
      return;
    }

    if (result.status === '2FA_REQUIRED') {
      res.status(202).json({
        requires2FA: true,
        twoFactorToken: result.token,
        method: result.method,
      });
      return;
    }

    if (result.status === 'INVALID_CREDENTIALS') {
      res.status(401).json({ error: result.message });
      return;
    }

    if (result.status === 'BLOCKED_OR_CHALLENGE') {
      res.status(403).json({ error: result.message, code: 'CLOUDFLARE_OR_CAPTCHA' });
      return;
    }

    res.status(502).json({ error: result.message });
  });

  app.post('/api/auth/verify-2fa', async (req: Request, res: Response) => {
    const { twoFactorToken, code, email } = req.body ?? {};
    if (typeof twoFactorToken !== 'string' || !twoFactorToken) {
      res.status(400).json({ error: 'ไม่พบโทเค็นยืนยัน 2FA กรุณาล็อกอินใหม่' });
      return;
    }
    if (typeof code !== 'string' || code.trim().length < 4) {
      res.status(400).json({ error: 'กรุณากรอกรหัสยืนยัน 2FA ให้ครบถ้วน' });
      return;
    }

    const result = await verifyIqOption2FA(twoFactorToken, code);
    if (result.status === 'OK') {
      const session = engine.createSession({
        email: typeof email === 'string' && email.trim() ? email.trim() : 'iq-user',
        mode: 'IQ_OPTION_LIVE',
        ssid: result.ssid,
      });
      res.json({
        token: session.token,
        email: session.email,
        mode: session.mode,
        iqConnected: session.iqConnected,
        iqStatusMessage: session.iqStatusMessage,
        scanningActive: session.scanningActive,
        config: session.config,
      });
      return;
    }

    res.status(401).json({
      error: result.status === 'INVALID_CREDENTIALS' || result.status === 'ERROR'
        ? result.message
        : 'ยืนยันรหัส 2FA ไม่สำเร็จ',
    });
  });

  app.post('/api/auth/logout', requireAuth, (req: AuthedRequest, res: Response) => {
    if (req.userSession) {
      engine.destroySession(req.userSession.token);
    }
    res.json({ ok: true });
  });

  // Scanner routes
  app.get('/api/scanner/state', requireAuth, (req: AuthedRequest, res: Response) => {
    const session = req.userSession!;
    const assets = engine.getScannedStates(session.config, session.token);
    const alerts = engine.getAlerts();
    res.json({
      session: {
        email: session.email,
        mode: session.mode,
        iqConnected: session.iqConnected,
        iqStatusMessage: session.iqStatusMessage,
        scanningActive: session.scanningActive,
      },
      config: session.config,
      assets,
      alerts,
    });
  });

  app.post('/api/scanner/toggle', requireAuth, (req: AuthedRequest, res: Response) => {
    const session = req.userSession!;
    const active = typeof req.body?.active === 'boolean' ? req.body.active : !session.scanningActive;
    engine.setScanningActive(session.token, active);
    res.json({ scanningActive: active });
  });

  app.put('/api/scanner/config', requireAuth, (req: AuthedRequest, res: Response) => {
    const session = req.userSession!;
    const body = req.body ?? {};
    const cur = session.config;

    const minCandles = Math.round(
      clampNumber(body.targetMinCandles, 3, 6, cur.targetMinCandles)
    );
    const maxCandles = Math.max(
      minCandles,
      Math.round(clampNumber(body.targetMaxCandles, 4, 7, cur.targetMaxCandles))
    );

    const nextConfig: Partial<ScannerConfig> = {
      targetMinCandles: minCandles,
      targetMaxCandles: maxCandles,
      maxWickRatio: clampNumber(body.maxWickRatio, 0.05, 0.55, cur.maxWickRatio),
      minUniformityScore: Math.round(
        clampNumber(body.minUniformityScore, 45, 95, cur.minUniformityScore)
      ),
      maxCounterCandles: Math.round(
        clampNumber(body.maxCounterCandles, 0, 1, cur.maxCounterCandles)
      ),
      maxBodyToMedianRatio: clampNumber(
        body.maxBodyToMedianRatio,
        1.2,
        3.5,
        cur.maxBodyToMedianRatio
      ),
      minBodyToMedianRatio: clampNumber(
        body.minBodyToMedianRatio,
        0.15,
        0.8,
        cur.minBodyToMedianRatio
      ),
      directionFilter:
        body.directionFilter === 'UP' ||
        body.directionFilter === 'DOWN' ||
        body.directionFilter === 'BOTH'
          ? body.directionFilter
          : cur.directionFilter,
      categoryFilter:
        body.categoryFilter === 'BINARY' ||
        body.categoryFilter === 'DIGITAL' ||
        body.categoryFilter === 'ALL'
          ? body.categoryFilter
          : cur.categoryFilter,
      soundEnabled:
        typeof body.soundEnabled === 'boolean' ? body.soundEnabled : cur.soundEnabled,
      soundVolume: clampNumber(body.soundVolume, 0.2, 1.0, cur.soundVolume),
      soundDurationMode:
        body.soundDurationMode === 'STANDARD' || body.soundDurationMode === 'LONG'
          ? body.soundDurationMode
          : cur.soundDurationMode,
      includeFormingInList:
        typeof body.includeFormingInList === 'boolean'
          ? body.includeFormingInList
          : cur.includeFormingInList,
    };

    const updated = engine.updateSessionConfig(session.token, nextConfig) ?? DEFAULT_SCANNER_CONFIG;
    const assets = engine.getScannedStates(updated, session.token);

    res.json({
      config: updated,
      assets,
    });
  });

  app.get('/api/download/package', async (_req: Request, res: Response) => {
    try {
      const zipBuf = await buildProgramZipBuffer();
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="FlowTrend-IQ-Program.zip"'
      );
      res.send(zipBuf);
    } catch {
      res.status(500).json({ error: 'ไม่สามารถสร้างไฟล์ดาวน์โหลดโปรแกรมได้' });
    }
  });

  app.post('/api/alerts/:id/decision', requireAuth, (req: AuthedRequest, res: Response) => {
    const id = req.params.id;
    const { acknowledged, decisionNote } = req.body ?? {};
    const validNote =
      decisionNote === 'WATCHED' ||
      decisionNote === 'TRADED_MANUAL' ||
      decisionNote === 'SKIPPED'
        ? decisionNote
        : undefined;

    const updated = engine.updateAlertDecision(id, {
      acknowledged: typeof acknowledged === 'boolean' ? acknowledged : undefined,
      decisionNote: validNote,
    });
    if (!updated) {
      res.status(404).json({ error: 'ไม่พบสัญญาณแจ้งเตือนที่ระบุ' });
      return;
    }
    res.json({ alert: updated });
  });

  // Ensure unknown /api/* routes always return JSON instead of SPA HTML
  app.all('/api/*', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'ไม่พบ API ที่เรียกใช้งาน' });
  });

  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/')) {
      res.status(500).json({
        error:
          err instanceof Error
            ? `เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์: ${err.message}`
            : 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์',
      });
      return;
    }
    next(err);
  });

  // Frontend Vite middleware or static dist
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  const server = http.createServer(app);

  // WebSocket Server on /ws
  const wss = new WebSocketServer({ noServer: true });
  const clientsByToken = new Map<WebSocket, string>();

  server.on('upgrade', (request, socket, head) => {
    const reqUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (reqUrl.pathname !== '/ws') {
      return; // let Vite or others ignore/handle
    }
    const token = reqUrl.searchParams.get('token') ?? undefined;
    const session = engine.getSession(token);
    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, session.token);
    });
  });

  wss.on('connection', (ws: WebSocket, token: string) => {
    clientsByToken.set(ws, token);

    const session = engine.getSession(token);
    if (session) {
      ws.send(
        JSON.stringify({
          type: 'scanner:snapshot',
          payload: {
            assets: engine.getScannedStates(session.config, session.token),
            alerts: engine.getAlerts(),
            iqConnected: session.iqConnected,
            iqStatusMessage: session.iqStatusMessage,
          },
        })
      );
    }

    ws.on('close', () => {
      clientsByToken.delete(ws);
    });
  });

  engine.subscribe((event) => {
    for (const [ws, token] of clientsByToken.entries()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const session = engine.getSession(token);
      if (!session) {
        ws.close();
        clientsByToken.delete(ws);
        continue;
      }
      if (event.type === 'scanner:snapshot') {
        ws.send(
          JSON.stringify({
            type: 'scanner:snapshot',
            payload: {
              assets: engine.getScannedStates(session.config, session.token),
              alerts: engine.getAlerts(),
              iqConnected: session.iqConnected,
              iqStatusMessage: session.iqStatusMessage,
            },
          })
        );
      } else if (event.type === 'signal:detected') {
        ws.send(JSON.stringify(event));
      }
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`FlowTrend IQ server listening on http://0.0.0.0:${PORT}`);
  });

  process.on('SIGTERM', () => {
    engine.shutdown();
    server.close();
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
