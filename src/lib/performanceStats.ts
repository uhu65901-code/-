import type { DecisionRecord, TrendAlert } from './types.ts';

export interface EquityPoint {
  index: number;
  label: string;
  assetName: string;
  direction: 'UP' | 'DOWN';
  outcome: 'WIN' | 'LOSS' | 'DRAW';
  tradeProfit: number;
  cumulativeProfit: number;
  runningWinRate: number;
}

export interface DirectionBreakdown {
  name: string;
  wins: number;
  losses: number;
  winRate: number;
  profit: number;
}

export interface ScoreBandBreakdown {
  band: string;
  wins: number;
  losses: number;
  winRate: number;
}

export interface PerformanceSummary {
  totalAlerts: number;
  totalDecisions: number;
  tradedCount: number;
  wins: number;
  losses: number;
  draws: number;
  skippedCount: number;
  watchedCount: number;
  winRate: number;
  netProfit: number;
  roiPercent: number;
  equitySeries: EquityPoint[];
  directionBreakdown: DirectionBreakdown[];
  scoreBandBreakdown: ScoreBandBreakdown[];
}

export function normalizeAssetHistoryKey(assetName: string, assetId: string): string {
  const cleanName = assetName.trim().toLowerCase();
  return cleanName || assetId.trim().toLowerCase();
}

export function deduplicateAlertsByAsset(alerts: TrendAlert[]): TrendAlert[] {
  const seen = new Set<string>();
  const out: TrendAlert[] = [];
  for (const alert of alerts) {
    const key = normalizeAssetHistoryKey(alert.assetName, alert.assetId);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alert);
  }
  return out;
}

export function computePerformanceStats(
  records: DecisionRecord[],
  alerts: TrendAlert[],
  stakeAmount = 100
): PerformanceSummary {
  const safeStake = Number.isFinite(stakeAmount) && stakeAmount > 0 ? stakeAmount : 100;

  // Combine explicit decision records with any alerts that have decisions not yet in records
  const byAlertId = new Map<string, DecisionRecord>();
  for (const r of records) {
    byAlertId.set(r.alertId, r);
  }
  for (const a of alerts) {
    if ((a.decisionNote || a.tradeOutcome) && !byAlertId.has(a.id)) {
      byAlertId.set(a.id, {
        id: a.id,
        alertId: a.id,
        assetId: a.assetId,
        assetName: a.assetName,
        direction: a.direction,
        payoutPercent: a.payoutPercent,
        matchScore: a.matchScore ?? a.uniformityScore,
        runLength: a.runLength,
        decisionNote: a.decisionNote ?? 'TRADED_MANUAL',
        tradeOutcome: a.tradeOutcome,
        recordedAt: a.createdAt,
      });
    }
  }

  const allDecisions = Array.from(byAlertId.values()).sort(
    (a, b) => a.recordedAt - b.recordedAt
  );

  let wins = 0;
  let losses = 0;
  let draws = 0;
  let skippedCount = 0;
  let watchedCount = 0;
  let cumulativeProfit = 0;

  const equitySeries: EquityPoint[] = [];

  const dirStats = {
    UP: { wins: 0, losses: 0, profit: 0 },
    DOWN: { wins: 0, losses: 0, profit: 0 },
  };

  const scoreStats = {
    '90-94%': { wins: 0, losses: 0 },
    '95-100%': { wins: 0, losses: 0 },
  };

  for (const rec of allDecisions) {
    if (rec.decisionNote === 'SKIPPED') skippedCount++;
    else if (rec.decisionNote === 'WATCHED' && !rec.tradeOutcome) watchedCount++;

    if (!rec.tradeOutcome) continue;

    let tradeProfit = 0;
    if (rec.tradeOutcome === 'WIN') {
      wins++;
      tradeProfit = Number(((safeStake * rec.payoutPercent) / 100).toFixed(2));
      dirStats[rec.direction].wins++;
      if (rec.matchScore >= 95) scoreStats['95-100%'].wins++;
      else scoreStats['90-94%'].wins++;
    } else if (rec.tradeOutcome === 'LOSS') {
      losses++;
      tradeProfit = -safeStake;
      dirStats[rec.direction].losses++;
      if (rec.matchScore >= 95) scoreStats['95-100%'].losses++;
      else scoreStats['90-94%'].losses++;
    } else {
      draws++;
      tradeProfit = 0;
    }

    dirStats[rec.direction].profit = Number(
      (dirStats[rec.direction].profit + tradeProfit).toFixed(2)
    );
    cumulativeProfit = Number((cumulativeProfit + tradeProfit).toFixed(2));

    const decidedSoFar = wins + losses;
    const runningWinRate =
      decidedSoFar > 0 ? Number(((wins / decidedSoFar) * 100).toFixed(1)) : 0;

    const d = new Date(rec.recordedAt);
    const label = `${String(d.getHours()).padStart(2, '0')}:${String(
      d.getMinutes()
    ).padStart(2, '0')}`;

    equitySeries.push({
      index: equitySeries.length + 1,
      label,
      assetName: rec.assetName,
      direction: rec.direction,
      outcome: rec.tradeOutcome,
      tradeProfit,
      cumulativeProfit,
      runningWinRate,
    });
  }

  const tradedCount = wins + losses + draws;
  const winRate =
    wins + losses > 0 ? Number(((wins / (wins + losses)) * 100).toFixed(1)) : 0;
  const totalRisked = tradedCount * safeStake;
  const roiPercent =
    totalRisked > 0 ? Number(((cumulativeProfit / totalRisked) * 100).toFixed(1)) : 0;

  return {
    totalAlerts: alerts.length,
    totalDecisions: allDecisions.length,
    tradedCount,
    wins,
    losses,
    draws,
    skippedCount,
    watchedCount,
    winRate,
    netProfit: cumulativeProfit,
    roiPercent,
    equitySeries,
    directionBreakdown: [
      {
        name: 'ขาขึ้น (CALL)',
        wins: dirStats.UP.wins,
        losses: dirStats.UP.losses,
        winRate:
          dirStats.UP.wins + dirStats.UP.losses > 0
            ? Number(
                ((dirStats.UP.wins / (dirStats.UP.wins + dirStats.UP.losses)) * 100).toFixed(1)
              )
            : 0,
        profit: dirStats.UP.profit,
      },
      {
        name: 'ขาลง (PUT)',
        wins: dirStats.DOWN.wins,
        losses: dirStats.DOWN.losses,
        winRate:
          dirStats.DOWN.wins + dirStats.DOWN.losses > 0
            ? Number(
                (
                  (dirStats.DOWN.wins / (dirStats.DOWN.wins + dirStats.DOWN.losses)) *
                  100
                ).toFixed(1)
              )
            : 0,
        profit: dirStats.DOWN.profit,
      },
    ],
    scoreBandBreakdown: [
      {
        band: '90–94%',
        wins: scoreStats['90-94%'].wins,
        losses: scoreStats['90-94%'].losses,
        winRate:
          scoreStats['90-94%'].wins + scoreStats['90-94%'].losses > 0
            ? Number(
                (
                  (scoreStats['90-94%'].wins /
                    (scoreStats['90-94%'].wins + scoreStats['90-94%'].losses)) *
                  100
                ).toFixed(1)
              )
            : 0,
      },
      {
        band: '95–100%',
        wins: scoreStats['95-100%'].wins,
        losses: scoreStats['95-100%'].losses,
        winRate:
          scoreStats['95-100%'].wins + scoreStats['95-100%'].losses > 0
            ? Number(
                (
                  (scoreStats['95-100%'].wins /
                    (scoreStats['95-100%'].wins + scoreStats['95-100%'].losses)) *
                  100
                ).toFixed(1)
              )
            : 0,
      },
    ],
  };
}
