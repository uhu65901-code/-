import http from 'http';
import path from 'path';
import fs from 'fs';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import {
  DEFAULT_SCANNER_CONFIG,
  type PatternFeatureVector,
  type PatternVerdict,
  type ScannerConfig,
  type TrendDirection,
} from './src/lib/types.ts';
import { createFeedbackSample } from './src/lib/aiPatternLearner.ts';
import { sanitizeCandleBodyConfig } from './src/lib/candleBodyStats.ts';
import {
  buildProgramZipBuffer,
  buildStandaloneAppHtmlBuffer,
} from './src/server/downloadPackage.ts';
import { loginWithIqOption, verifyIqOption2FA } from './src/server/iqOptionClient.ts';
import { MarketScannerEngine, type UserSession } from './src/server/marketEngine.ts';

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
  app.use(express.json({ limit: '4mb' }));

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
      aiSamples: engine.getAiSamples(),
      aiModel: engine.getAiModel(),
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

    const scanWindowBars = Math.round(
      clampNumber(body.scanWindowBars, 15, 20, cur.scanWindowBars)
    );
    const minCandles = Math.round(
      clampNumber(body.targetMinCandles, 3, 8, cur.targetMinCandles)
    );
    const maxCandles = Math.max(
      minCandles,
      Math.round(clampNumber(body.targetMaxCandles, 3, 10, cur.targetMaxCandles))
    );

    const nextConfig: Partial<ScannerConfig> = {
      scanWindowBars,
      targetMinCandles: minCandles,
      targetMaxCandles: maxCandles,
      maxWickRatio: clampNumber(body.maxWickRatio, 0.05, 0.55, cur.maxWickRatio),
      minUniformityScore: Math.round(
        clampNumber(body.minUniformityScore, 45, 95, cur.minUniformityScore)
      ),
      minMatchScore: Math.round(
        clampNumber(body.minMatchScore, 75, 98, cur.minMatchScore)
      ),
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
      aiLearningEnabled:
        typeof body.aiLearningEnabled === 'boolean'
          ? body.aiLearningEnabled
          : cur.aiLearningEnabled,
      aiInfluencePercent: Math.round(
        clampNumber(body.aiInfluencePercent, 0, 60, cur.aiInfluencePercent)
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
      rankRefreshIntervalSec: Math.round(
        clampNumber(body.rankRefreshIntervalSec, 30, 60, cur.rankRefreshIntervalSec)
      ),
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

  app.get('/api/download/package', async (_req: Request, res: Response) => {
    try {
      const zipBuf = await buildProgramZipBuffer();
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="FlowTrend-IQ-PC-Setup.zip"'
      );
      res.send(zipBuf);
    } catch {
      res.status(500).json({ error: 'ไม่สามารถสร้างไฟล์ติดตั้งโปรแกรมได้' });
    }
  });

  app.get('/api/download/android-app', async (_req: Request, res: Response) => {
    try {
      const htmlBuf = await buildStandaloneAppHtmlBuffer();
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="FlowTrend-IQ-App.html"'
      );
      res.send(htmlBuf);
    } catch {
      res.status(500).json({ error: 'ไม่สามารถสร้างไฟล์แอปสำหรับ Android ได้' });
    }
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

  app.post('/api/ai/feedback', requireAuth, (req: AuthedRequest, res: Response) => {
    const session = req.userSession!;
    const body = req.body ?? {};
    const verdict: PatternVerdict | null =
      body.verdict === 'PASS' || body.verdict === 'REJECT' ? body.verdict : null;
    const direction: TrendDirection | null =
      body.direction === 'UP' || body.direction === 'DOWN' ? body.direction : null;
    const assetId = typeof body.assetId === 'string' ? body.assetId.trim() : '';
    const assetName = typeof body.assetName === 'string' ? body.assetName.trim() : '';
    const rawFeatures = body.features as Partial<PatternFeatureVector> | undefined;

    if (!verdict || !direction || !assetId || !assetName || !rawFeatures) {
      res.status(400).json({ error: 'ข้อมูลตัวอย่างทรงกราฟสำหรับสอน AI ไม่ครบถ้วน' });
      return;
    }

    const features: PatternFeatureVector = {
      runLengthNorm: clampNumber(rawFeatures.runLengthNorm, 0.3, 1.6, 0.8),
      avgWickRatio: clampNumber(rawFeatures.avgWickRatio, 0, 1, 0.12),
      reverseWickRatio: clampNumber(rawFeatures.reverseWickRatio, 0, 1.5, 0.1),
      uniformityScoreNorm: clampNumber(rawFeatures.uniformityScoreNorm, 0, 1, 0.85),
      avgBodyToMedianRatio: clampNumber(rawFeatures.avgBodyToMedianRatio, 0.2, 2.5, 1),
      bodyTrendSlope: clampNumber(rawFeatures.bodyTrendSlope, 0.4, 1.8, 1),
      directionalEfficiency: clampNumber(rawFeatures.directionalEfficiency, 0, 1, 0.85),
      emaDistanceRatio: clampNumber(rawFeatures.emaDistanceRatio, 0, 3, 0.7),
      swingScoreNorm: clampNumber(rawFeatures.swingScoreNorm, 0, 1, 0.9),
    };

    if (verdict === 'PASS' && features.directionalEfficiency < 0.42) {
      res.status(400).json({
        error:
          'กราฟนี้ยังเป็นไซด์เวย์ในกรอบ M15 — หากต้องการสอนว่าไม่สวย กรุณากดปุ่ม "ไม่ผ่าน" แทน',
      });
      return;
    }

    const sample = createFeedbackSample({
      alertId: typeof body.alertId === 'string' ? body.alertId : undefined,
      assetId,
      assetName,
      direction,
      verdict,
      baseMatchScore: Math.round(clampNumber(body.baseMatchScore, 0, 100, 88)),
      aiScoreAtTime:
        typeof body.aiScoreAtTime === 'number'
          ? Math.round(clampNumber(body.aiScoreAtTime, 0, 100, 80))
          : undefined,
      runLength: Math.round(clampNumber(body.runLength, 1, 15, 5)),
      avgWickRatio: clampNumber(body.avgWickRatio, 0, 1, 0.12),
      uniformityScore: Math.round(clampNumber(body.uniformityScore, 0, 100, 85)),
      features,
    });

    const result = engine.addAiFeedbackSample(sample);
    const assets = engine.getScannedStates(session.config, session.token);

    res.json({
      sample,
      aiSamples: result.aiSamples,
      aiModel: result.aiModel,
      alerts: result.alerts,
      assets,
    });
  });

  app.post('/api/ai/sync', requireAuth, (req: AuthedRequest, res: Response) => {
    const session = req.userSession!;
    const rawSamples = Array.isArray(req.body?.samples) ? req.body.samples : [];
    const result = engine.syncAiSamples(rawSamples);
    const assets = engine.getScannedStates(session.config, session.token);
    res.json({
      aiSamples: result.aiSamples,
      aiModel: result.aiModel,
      assets,
    });
  });

  app.delete('/api/ai/feedback/:id', requireAuth, (req: AuthedRequest, res: Response) => {
    const session = req.userSession!;
    const result = engine.removeAiSample(req.params.id);
    const assets = engine.getScannedStates(session.config, session.token);
    res.json({
      aiSamples: result.aiSamples,
      aiModel: result.aiModel,
      assets,
    });
  });

  app.post('/api/ai/reset', requireAuth, (req: AuthedRequest, res: Response) => {
    const session = req.userSession!;
    const result = engine.clearAiSamples();
    const assets = engine.getScannedStates(session.config, session.token);
    res.json({
      aiSamples: result.aiSamples,
      aiModel: result.aiModel,
      assets,
    });
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

  const server = http.createServer(app);

  // Frontend Vite middleware or static dist
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: { server, path: '/vite-hmr' },
        hmr: hmrDisabled ? false : { server, path: '/vite-hmr' },
        watch: hmrDisabled ? null : {},
      },
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

  // WebSocket Server on /ws
  const wss = new WebSocketServer({ noServer: true });
  const clientsByToken = new Map<WebSocket, string>();

  server.on('upgrade', (request, socket, head) => {
    const reqUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (reqUrl.pathname !== '/ws') {
      return; // let Vite HMR handle /vite-hmr
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

    ws.on('error', () => {
      clientsByToken.delete(ws);
    });

    const session = engine.getSession(token);
    if (session) {
      ws.send(
        JSON.stringify({
          type: 'scanner:snapshot',
          payload: {
            assets: engine.getScannedStates(session.config, session.token),
            alerts: engine.getAlerts(),
            decisionRecords: engine.getDecisionRecords(),
            aiSamples: engine.getAiSamples(),
            aiModel: engine.getAiModel(),
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
              decisionRecords: engine.getDecisionRecords(),
              aiSamples: engine.getAiSamples(),
              aiModel: engine.getAiModel(),
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
