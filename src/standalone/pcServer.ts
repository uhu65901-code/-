import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { loginWithIqOption, verifyIqOption2FA } from '../server/iqOptionClient.ts';
import { MarketScannerEngine, UserSession } from '../server/marketEngine.ts';
import { DEFAULT_SCANNER_CONFIG, ScannerConfig } from '../lib/types.ts';
import { sanitizeCandleBodyConfig } from '../lib/candleBodyStats.ts';

interface AuthedRequest extends Request {
  userSession?: UserSession;
}

function clampNumber(val: unknown, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function getLanUrls(port: number): string[] {
  const urls: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const entries of Object.values(ifaces)) {
    if (!entries) continue;
    for (const info of entries) {
      if (info.family === 'IPv4' && !info.internal) {
        urls.push(`http://${info.address}:${port}`);
      }
    }
  }
  return urls;
}

function startStandaloneServer() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  const engine = new MarketScannerEngine();
  const server = http.createServer(app);
  const port = Number(process.env.PORT) || 3847;

  const requireAuth = (req: AuthedRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const session = token ? engine.getSession(token) : undefined;
    if (!session) {
      res.status(401).json({ error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
      return;
    }
    req.userSession = session;
    next();
  };

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, standalone: true, time: Date.now() });
  });

  app.get('/api/server-info', (_req: Request, res: Response) => {
    res.json({
      standalone: true,
      port,
      localUrl: `http://127.0.0.1:${port}`,
      lanUrls: getLanUrls(port),
    });
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    const { mode, email, password, ssid } = req.body ?? {};

    if (mode === 'DEMO') {
      const session = engine.createSession({
        email: typeof email === 'string' && email.trim() ? email.trim() : 'demo@flowtrend.local',
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
        res.status(400).json({ error: 'กรุณาระบุ Session SSID ของ IQ Option ให้ถูกต้อง' });
        return;
      }
      const session = engine.createSession({
        email: typeof email === 'string' && email.trim() ? email.trim() : 'iq-ssid-session',
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

    if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || password.length < 4) {
      res.status(400).json({ error: 'กรุณากรอกอีเมล (Gmail) และรหัสผ่าน IQ Option ให้ครบถ้วน' });
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
      error:
        result.status === 'INVALID_CREDENTIALS' || result.status === 'ERROR'
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

  app.get('/api/scanner/state', requireAuth, (req: AuthedRequest, res: Response) => {
    const session = req.userSession!;
    const assets = engine.getScannedStates(session.config, session.token);
    const alerts = engine.getAlerts();
    const decisionRecords = engine.getDecisionRecords();
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
      decisionRecords,
    });
  });

  app.post('/api/scanner/toggle', requireAuth, (req: AuthedRequest, res: Response) => {
    const session = req.userSession!;
    const active = typeof req.body?.active === 'boolean' ? req.body.active : !session.scanningActive;
    engine.setScanningActive(session.token, active);
    res.json({ scanningActive: active });
  });

  app.post('/api/scanner/select-asset', requireAuth, (req: AuthedRequest, res: Response) => {
    const session = req.userSession!;
    const assetId = typeof req.body?.assetId === 'string' ? req.body.assetId : '';
    if (assetId) {
      engine.requestAssetCandles(session.token, assetId);
    }
    res.json({ ok: true });
  });

  app.put('/api/scanner/config', requireAuth, (req: AuthedRequest, res: Response) => {
    const session = req.userSession!;
    const body = req.body ?? {};
    const cur = session.config;

    const minCandles = Math.round(clampNumber(body.targetMinCandles, 3, 8, cur.targetMinCandles));
    const maxCandles = Math.max(
      minCandles,
      Math.round(clampNumber(body.targetMaxCandles, 3, 10, cur.targetMaxCandles))
    );

    const nextConfig: Partial<ScannerConfig> = {
      targetMinCandles: minCandles,
      targetMaxCandles: maxCandles,
      maxWickRatio: clampNumber(body.maxWickRatio, 0.05, 0.55, cur.maxWickRatio),
      minUniformityScore: Math.round(
        clampNumber(body.minUniformityScore, 45, 95, cur.minUniformityScore)
      ),
      minMatchScore: Math.round(clampNumber(body.minMatchScore, 75, 98, cur.minMatchScore)),
      maxCounterCandles: Math.round(
        clampNumber(body.maxCounterCandles, 0, 2, cur.maxCounterCandles)
      ),
      maxBodyToMedianRatio: clampNumber(
        body.maxBodyToMedianRatio,
        1.1,
        3.5,
        cur.maxBodyToMedianRatio
      ),
      minBodyToMedianRatio: clampNumber(
        body.minBodyToMedianRatio,
        0.15,
        0.8,
        cur.minBodyToMedianRatio
      ),
      realtimeAlertImmediate:
        typeof body.realtimeAlertImmediate === 'boolean'
          ? body.realtimeAlertImmediate
          : cur.realtimeAlertImmediate,
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
      soundEnabled: typeof body.soundEnabled === 'boolean' ? body.soundEnabled : cur.soundEnabled,
      soundVolume: clampNumber(body.soundVolume, 0.2, 1.0, cur.soundVolume),
      soundDurationMode:
        body.soundDurationMode === 'STANDARD' || body.soundDurationMode === 'LONG'
          ? body.soundDurationMode
          : cur.soundDurationMode,
      includeFormingInList:
        typeof body.includeFormingInList === 'boolean'
          ? body.includeFormingInList
          : cur.includeFormingInList,
      candleBodyDisplay: body.candleBodyDisplay
        ? sanitizeCandleBodyConfig(body.candleBodyDisplay)
        : cur.candleBodyDisplay,
      candleWickDisplay: body.candleWickDisplay
        ? sanitizeCandleBodyConfig(body.candleWickDisplay)
        : cur.candleWickDisplay,
    };

    const updated = engine.updateSessionConfig(session.token, nextConfig) ?? DEFAULT_SCANNER_CONFIG;
    const assets = engine.getScannedStates(updated, session.token);

    res.json({
      config: updated,
      assets,
    });
  });

  app.post('/api/alerts/:id/decision', requireAuth, (req: AuthedRequest, res: Response) => {
    const id = req.params.id;
    const { acknowledged, decisionNote, tradeOutcome } = req.body ?? {};
    const validNote =
      decisionNote === 'WATCHED' ||
      decisionNote === 'TRADED_MANUAL' ||
      decisionNote === 'SKIPPED'
        ? decisionNote
        : undefined;
    const validOutcome =
      tradeOutcome === 'WIN' || tradeOutcome === 'LOSS' || tradeOutcome === 'DRAW'
        ? tradeOutcome
        : undefined;

    const updated = engine.updateAlertDecision(id, {
      acknowledged: typeof acknowledged === 'boolean' ? acknowledged : undefined,
      decisionNote: validNote,
      tradeOutcome: validOutcome,
    });
    if (!updated) {
      res.status(404).json({ error: 'ไม่พบสัญญาณแจ้งเตือนที่ระบุ' });
      return;
    }
    res.json({ alert: updated, decisionRecords: engine.getDecisionRecords() });
  });

  const uiDir = path.resolve(process.cwd(), 'app', 'ui');
  const fallbackDistDir = path.resolve(process.cwd(), 'dist');
  const staticDir = fs.existsSync(uiDir) ? uiDir : fallbackDistDir;

  app.use(express.static(staticDir));
  app.use((_req: Request, res: Response) => {
    const indexPath = path.join(staticDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send('UI bundle missing');
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  const wsClients = new Map<WebSocket, string>();

  wss.on('connection', (ws: WebSocket, req) => {
    try {
      const reqUrl = new URL(req.url || '/ws', 'http://localhost');
      const token = reqUrl.searchParams.get('token') ?? '';
      const session = token ? engine.getSession(token) : undefined;
      if (!session) {
        ws.close(1008, 'Unauthorized');
        return;
      }
      wsClients.set(ws, token);

      ws.send(
        JSON.stringify({
          type: 'scanner:snapshot',
          payload: {
            assets: engine.getScannedStates(session.config, session.token),
            alerts: engine.getAlerts(),
            decisionRecords: engine.getDecisionRecords(),
            iqConnected: session.iqConnected,
            iqStatusMessage: session.iqStatusMessage,
          },
        })
      );

      ws.on('close', () => {
        wsClients.delete(ws);
      });
    } catch {
      ws.close();
    }
  });

  engine.subscribe((evt) => {
    if (evt.type === 'signal:detected') {
      const message = JSON.stringify(evt);
      for (const [client] of wsClients.entries()) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      }
      return;
    }

    for (const [client, token] of wsClients.entries()) {
      if (client.readyState !== WebSocket.OPEN) continue;
      const session = engine.getSession(token);
      if (!session) continue;

      client.send(
        JSON.stringify({
          type: 'scanner:snapshot',
          payload: {
            assets: engine.getScannedStates(session.config, session.token),
            alerts: engine.getAlerts(),
            decisionRecords: engine.getDecisionRecords(),
            iqConnected: session.iqConnected,
            iqStatusMessage: session.iqStatusMessage,
          },
        })
      );
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`FlowTrend IQ Standalone running at http://127.0.0.1:${port}`);
    for (const lan of getLanUrls(port)) {
      console.log(`LAN URL: ${lan}`);
    }
  });
}

startStandaloneServer();
