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

export const calculateWMA = (values: number[], period = 9): number[] => {
  const res = new Array(values.length).fill(NaN);
  if (!values || values.length === 0) return res;
  for (let i = 0; i < values.length; i++) {
    if (i + 1 < period) continue;
    let denom = 0;
    let sum = 0;
    for (let j = 0; j < period; j++) {
      const w = period - j;
      const v = values[i - j];
      if (Number.isNaN(v)) {
        sum = NaN;
        break;
      }
      sum += v * w;
      denom += w;
    }
    if (!Number.isNaN(sum)) res[i] = sum / denom;
  }
  return res;
};

export const calculateHMA = (values: number[], period = 21): number[] => {
  // HMA = WMA(2*WMA(period/2) - WMA(period)) with final period = sqrt(period)
  const half = Math.max(1, Math.floor(period / 2));
  const sqrtP = Math.max(1, Math.floor(Math.sqrt(period)));

  const wmaFull = calculateWMA(values, period);
  const wmaHalf = calculateWMA(values, half);

  // Generate series: 2*wmaHalf - wmaFull
  const diff: number[] = new Array(values.length).fill(NaN);
  for (let i = 0; i < values.length; i++) {
    const a = wmaHalf[i];
    const b = wmaFull[i];
    if (Number.isNaN(a) || Number.isNaN(b)) continue;
    diff[i] = 2 * a - b;
  }

  // HMA is WMA of diff with period sqrtP
  const hma = calculateWMA(diff, sqrtP);
  return hma;
};

export const calculateSMMA = (values: number[], period = 21): number[] => {
  // Smoothed Moving Average (SMMA) — first value is SMA of first 'period' values
  const res = new Array(values.length).fill(NaN);
  if (!values || values.length === 0) return res;
  let prev: number | null = null;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isNaN(v)) continue;
    if (i < period) {
      sum += v;
      if (i === period - 1) {
        prev = sum / period;
        res[i] = prev;
      }
      continue;
    }
    if (prev === null) continue;
    // SMMA(i) = (prev*(period-1) + v) / period
    prev = (prev * (period - 1) + v) / period;
    res[i] = prev;
  }
  return res;
};

/**
 * Calculate ADX (Average Directional Index)
 * Measures trend strength (0-100+), with values > 18-20 indicating strong trend
 * @param highs - Array of high prices
 * @param lows - Array of low prices
 * @param closes - Array of close prices
 * @param period - ADX period (default 14)
 * @returns Array of ADX values
 */
export const calculateADX = (highs: number[], lows: number[], closes: number[], period = 14): number[] => {
  const length = closes.length;
  const adx: number[] = new Array(length).fill(NaN);
  
  if (length < period + 1) return adx;
  
  // Calculate True Range (TR)
  const tr: number[] = new Array(length).fill(NaN);
  for (let i = 1; i < length; i++) {
    const high = highs[i];
    const low = lows[i];
    const prevClose = closes[i - 1];
    
    const hl = high - low;
    const hc = Math.abs(high - prevClose);
    const lc = Math.abs(low - prevClose);
    
    tr[i] = Math.max(hl, hc, lc);
  }
  
  // Calculate +DM and -DM (Directional Movement)
  const plusDM: number[] = new Array(length).fill(0);
  const minusDM: number[] = new Array(length).fill(0);
  
  for (let i = 1; i < length; i++) {
    const highDiff = highs[i] - highs[i - 1];
    const lowDiff = lows[i - 1] - lows[i];
    
    if (highDiff > lowDiff && highDiff > 0) {
      plusDM[i] = highDiff;
    }
    if (lowDiff > highDiff && lowDiff > 0) {
      minusDM[i] = lowDiff;
    }
  }
  
  // Smooth TR, +DM, -DM using Wilder's smoothing (same as SMMA)
  const smoothedTR = calculateSMMA(tr, period);
  const smoothedPlusDM = calculateSMMA(plusDM, period);
  const smoothedMinusDM = calculateSMMA(minusDM, period);
  
  // Calculate +DI and -DI (Directional Indicators)
  const plusDI: number[] = new Array(length).fill(NaN);
  const minusDI: number[] = new Array(length).fill(NaN);
  
  for (let i = 0; i < length; i++) {
    if (!Number.isNaN(smoothedTR[i]) && smoothedTR[i] !== 0) {
      plusDI[i] = (smoothedPlusDM[i] / smoothedTR[i]) * 100;
      minusDI[i] = (smoothedMinusDM[i] / smoothedTR[i]) * 100;
    }
  }
  
  // Calculate DX (Directional Index)
  const dx: number[] = new Array(length).fill(NaN);
  for (let i = 0; i < length; i++) {
    if (!Number.isNaN(plusDI[i]) && !Number.isNaN(minusDI[i])) {
      const sum = plusDI[i] + minusDI[i];
      if (sum !== 0) {
        dx[i] = (Math.abs(plusDI[i] - minusDI[i]) / sum) * 100;
      }
    }
  }
  
  // Calculate ADX (smoothed DX using SMMA/Wilder smoothing)
  const adxValues = calculateSMMA(dx, period);
  
  return adxValues;
};
