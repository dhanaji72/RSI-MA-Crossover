import { fetch } from "undici";
import { DateTime } from "luxon";

const SYMBOL = "^NSEI";
const INTERVAL = "5m";
const TZ = "Asia/Kolkata";

const RSI_LEN = 14;
const RSI_EMA_LEN = 21;

// ---------------- RSI ----------------
function rsiWilder(closes: number[], period: number): number[] {
  const rsi = Array(closes.length).fill(NaN);
  if (closes.length <= period) return rsi;

  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    gain += Math.max(0, ch);
    loss += Math.max(0, -ch);
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, ch)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -ch)) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

// ---------------- SMMA (Wilder) ----------------
// ---------------- EMA ----------------
function ema(values: number[], period: number): number[] {
  const out = Array(values.length).fill(NaN);
  if (values.length < period) return out;

  // initial SMA for first EMA value
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;

  const alpha = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prev = alpha * values[i] + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

// ---------------- Yahoo RAW API ----------------
interface Bar {
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function fetchYahoo5m(days: number): Promise<Bar[]> {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - days * 24 * 60 * 60;

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(SYMBOL)}` +
    `?period1=${period1}&period2=${period2}&interval=${INTERVAL}&includePrePost=false`;

  const res = await fetch(url);
  const json: any = await res.json();

  const result = json?.chart?.result?.[0];
  if (!result) return [];

  const quote = result.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const volumes = quote.volume || [];

  const bars: Bar[] = [];
  let missingVolumeCount = 0;
  
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    const h = highs[i];
    const l = lows[i];
    const v = volumes[i];
    
    if (typeof c === 'number') {
      // Ensure volume is a valid number; log warning if missing
      const vol = (v !== null && v !== undefined && typeof v === 'number' && v > 0) ? Number(v) : 0;
      if (vol === 0) missingVolumeCount++;
      
      bars.push({ 
        high: Number(h || c), 
        low: Number(l || c), 
        close: Number(c), 
        volume: vol 
      });
    }
  }
  
  // Log warning if significant volume data is missing
  if (missingVolumeCount > 0) {
    console.warn(`Warning: ${missingVolumeCount}/${bars.length} bars have missing/zero volume data. MFI calculation may be inaccurate.`);
  }
  
  return bars;
}

// ---------------- Scheduler ----------------
function msUntilNext5mIST() {
  const now = DateTime.now().setZone(TZ);
  const next = now.plus({ minutes: 5 - (now.minute % 5) }).startOf("minute");
  return Math.max(1000, next.toMillis() - now.toMillis());
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------- MFI (Money Flow Index) ----------------
// Standard MFI calculation (TradingView/Zerodha compatible)
function mfi(bars: Bar[], period: number = 14): number[] {
  const out = Array(bars.length).fill(NaN);
  if (bars.length <= period) return out;

  // Typical Price = (High + Low + Close) / 3
  const tp = bars.map(b => (b.high + b.low + b.close) / 3);
  // Raw Money Flow = Typical Price × Volume
  const rawMF = bars.map((b, i) => tp[i] * (b.volume || 0));

  // Calculate MFI for each bar starting from index 'period'
  for (let i = period; i < bars.length; i++) {
    let posFlow = 0;
    let negFlow = 0;
    
    // Look back 'period' bars and classify money flow
    for (let j = i - period + 1; j <= i; j++) {
      if (j === 0) continue; // Skip first bar as we can't compare
      
      if (tp[j] > tp[j - 1]) {
        posFlow += rawMF[j];
      } else if (tp[j] < tp[j - 1]) {
        negFlow += rawMF[j];
      }
      // If tp[j] === tp[j-1], don't add to either (standard behavior)
    }
    
    // MFI = 100 - (100 / (1 + Money Flow Ratio))
    // Money Flow Ratio = Positive Flow / Negative Flow
    if (negFlow === 0) {
      out[i] = 100;
    } else {
      const ratio = posFlow / negFlow;
      out[i] = 100 - (100 / (1 + ratio));
    }
  }
  return out;
}

// ---------------- MAIN LOOP ----------------
async function tick() {
  let bars: Bar[] = [];

  for (const d of [3, 7, 14, 30]) {
    bars = await fetchYahoo5m(d);
    if (bars.length >= RSI_LEN + RSI_EMA_LEN + 20) break;
  }

  if (bars.length < RSI_LEN + 2) {
    console.log("RSI=NA");
    console.log("RSI_EMA=NA");
    console.log("MFI=NA");
    return;
  }

  const closes = bars.map(b => b.close);
  const rsiSeries = rsiWilder(closes, RSI_LEN).map(v => isNaN(v) ? 50 : v);
  const emaSeries = ema(rsiSeries, RSI_EMA_LEN);
  
  // Check if we have sufficient volume data for MFI
  const hasVolume = bars.some(b => b.volume > 0);
  let mfiSeries: number[] = [];
  
  if (hasVolume) {
    mfiSeries = mfi(bars, 14);
  } else {
    console.warn('No volume data available from Yahoo API. MFI cannot be calculated.');
    mfiSeries = Array(bars.length).fill(NaN);
  }

  const last = bars.length - 1;

  console.log(`RSI=${rsiSeries[last].toFixed(2)}`);
  console.log(`RSI_EMA=${isNaN(emaSeries[last]) ? 'NA' : emaSeries[last].toFixed(2)}`);
  console.log(`MFI=${isNaN(mfiSeries[last]) ? 'NA' : mfiSeries[last].toFixed(2)}`);
}

async function main() {
  while (true) {
    try {
      await tick();
    } catch {
      console.log("RSI=NA");
      console.log("RSI_EMA=NA");
      console.log("MFI=NA");
    }
    await sleep(msUntilNext5mIST());
  }
}

main();
