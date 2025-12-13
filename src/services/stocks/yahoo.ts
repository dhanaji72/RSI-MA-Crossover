import yahooFinance from 'yahoo-finance2';

/**
 * Fetch recent intraday bars for a symbol using yahoo-finance2 chart API.
 * Falls back to smaller ranges if necessary and enforces a minimum number of bars.
 */
export async function getRecentBars(symbol: string, period = '5m', count = 500, minBarsOverride?: number) {
  const yf = new (yahooFinance as any)();
  const RSI_LENGTH = 14;
  const RSI_EMA_LENGTH = 21;
  const minBars = Math.max(40, RSI_LENGTH + RSI_EMA_LENGTH + 5, minBarsOverride || 0);
  const ranges = [7, 3, 1];

  for (const days of ranges) {
    try {
      const period2 = new Date();
      const period1 = new Date(period2.getTime() - days * 24 * 60 * 60 * 1000);
      console.log(`Attempting Yahoo chart for ${days}d with interval=${period}`);
      const chart = await yf.chart(symbol, { period1, period2, interval: period });
      const result = chart?.chart?.result?.[0];
      if (!result) {
        console.log(`No result for ${days}d`);
        continue;
      }
      const timestamps: number[] = result.timestamp || [];
      const indicator = result.indicators?.quote?.[0] || {};
      const opens = indicator?.open || [];
      const highs = indicator?.high || [];
      const lows = indicator?.low || [];
      const closes = indicator?.close || [];
      const volumes = indicator?.volume || [];
      const bars = timestamps.map((t: number, i: number) => ({
        date: new Date(t * 1000),
        open: opens[i],
        high: highs[i],
        low: lows[i],
        close: closes[i],
        volume: volumes[i]
      }));

      if (bars.length >= minBars) {
        console.log(`Using ${bars.length} bars from ${days}d response`);
        return bars.slice(-count);
      }

      // otherwise try next smaller range
      if (bars.length > 0) {
        console.log(`Only ${bars.length} bars available from ${days}d; trying shorter range`);
        const fallback = bars.slice(-count);
        if (days === ranges[ranges.length - 1]) return fallback;
      }
    } catch (err: any) {
      console.warn(`Yahoo chart for ${days}d failed:`, (err as any).message || err);
      continue;
    }
  }

  return [];
}

export default {
  getRecentBars
};
