// Indicator utilities (RSI and EMA), using Wilder smoothing for RSI

export const calculateRSI = (closes: number[], period = 14): number[] => {
  if (!closes || closes.length <= period) return Array(closes.length).fill(NaN);

  const rsi: number[] = new Array(closes.length).fill(NaN);

  // Calculate initial gains/losses
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gainSum += change;
    else lossSum += Math.abs(change);
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  const firstIdx = period; // first RSI corresponds to closes[firstIdx]
  rsi[firstIdx] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  // Wilder smoothing for subsequent values (same as TradingView/Zerodha RSI)
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return rsi;
};

export const calculateEMA = (values: number[], period = 21): number[] => {
  // Returns EMA series aligned with input values; NaN where insufficient data.
  const result: number[] = new Array(values.length).fill(NaN);
  if (!values || values.length === 0) return result;
  const alpha = 2 / (period + 1);
  let prevEma: number | null = null;
  let window: number[] = [];

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isNaN(v)) {
      continue;
    }
    window.push(v);
    if (window.length < period) {
      // Not enough data yet for initial EMA
      continue;
    }
    if (prevEma === null) {
      // initial EMA = simple average of first 'period' values
      const initial = window.slice(-period).reduce((a, b) => a + b, 0) / period;
      prevEma = initial;
      result[i] = prevEma;
      continue;
    }
    prevEma = prevEma + alpha * (v - prevEma);
    result[i] = prevEma;
  }

  return result;
};
