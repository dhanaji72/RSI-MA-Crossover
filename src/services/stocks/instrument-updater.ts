import { DateTime } from 'luxon';
import { getCurrentInterval, getCandleStartTime, INTERVAL_MINUTES } from './candle-config';

// ==================== Hybrid Candle Types ====================
export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  time: number;
}

// ==================== Hybrid Candle State ====================
let hybridCandles: Candle[] = [];
let lastCandleTime: number | null = null;

// ==================== Configuration ====================
// Note: INTERVAL_MINUTES is now imported from candle-config.ts
const NIFTY_TOKEN = '26000'; // NIFTY 50 token for NSE
const NIFTY_EXCHANGE = 'NSE';

// ==================== Fetch Historical Candles from Yahoo ====================
export async function fetchYahooSeedCandles(symbol = '^NSEI', intervalMin = INTERVAL_MINUTES, count = 200): Promise<Candle[]> {
  // Yahoo Finance API for NIFTY 50 index
  // Request enough historical data to ensure we get at least the required candles
  const { fetch } = await import('undici');
  const period2 = Math.floor(Date.now() / 1000);
  
  // Indian market hours: 9:15 AM to 3:30 PM = 6.25 hours/day, 5 days/week
  // For 5-min candles: ~75 candles per day
  // Account for weekends, holidays, and ensure we get enough data
  // Yahoo Finance limits: max 7 days for 5m interval, 60 days for 15m, 730 days for 1d
  // For 5m interval, we need to limit our request to 7 days max
  let adjustedIntervalMin = intervalMin;
  let adjustedCount = count;
  
  // If using 5m interval, limit to 7 days
  if (intervalMin === 5) {
    const maxDays = 7;
    const maxCandles = maxDays * 75; // ~75 candles per day for 5m
    if (count > maxCandles) {
      console.warn(`   Yahoo limits 5m interval to 7 days. Adjusting from ${count} to ${maxCandles} candles`);
      adjustedCount = maxCandles;
    }
    const bufferDays = Math.min(7, Math.max(Math.ceil(adjustedCount / 75) + 1, 2));
    const period1 = period2 - (bufferDays * 24 * 60 * 60);
    
    var url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?period1=${period1}&period2=${period2}&interval=${adjustedIntervalMin}m&includePrePost=false`;
  } else {
    const daysNeeded = Math.ceil((adjustedCount * adjustedIntervalMin) / (6.25 * 60));
    const bufferDays = Math.max(daysNeeded * 3, 60);
    const period1 = period2 - (bufferDays * 24 * 60 * 60);
    
    var url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?period1=${period1}&period2=${period2}&interval=${adjustedIntervalMin}m&includePrePost=false`;
  }
  
  try {
    console.log(`   Requesting ${adjustedCount} candles at ${adjustedIntervalMin}m interval...`);
    const res = await fetch(url);
    
    if (!res.ok) {
      console.error(`   Yahoo API HTTP error: ${res.status} ${res.statusText}`);
      return [];
    }
    
    const json: any = await res.json();
    return processYahooResponse(json, count);
  } catch (err: any) {
    console.error('   Error fetching Yahoo candles:', err.message || err);
    return [];
  }
}

// Helper function to process Yahoo response
function processYahooResponse(json: any, count: number): Candle[] {
  // Check for error in response
  if (json?.chart?.error) {
    console.error(`   Yahoo API error: ${json.chart.error.code} - ${json.chart.error.description}`);
    return [];
  }
  
  const result = json?.chart?.result?.[0];
  if (!result) {
    console.error('   Yahoo API returned no result data');
    return [];
  }
  
  const timestamps = result.timestamp || [];
  const quotes = result.indicators?.quote?.[0] || {};
  
  if (timestamps.length === 0) {
    console.error('   Yahoo API returned no timestamps');
    return [];
  }
  
  const candles = timestamps.map((t: number, i: number) => ({
    open: quotes.open?.[i],
    high: quotes.high?.[i],
    low: quotes.low?.[i],
    close: quotes.close?.[i],
    volume: quotes.volume?.[i],
    time: t * 1000
  })).filter((c: any) => c.open && c.close);
  
  console.log(`   Received ${candles.length} valid candles from Yahoo`);
  
  if (candles.length < count) {
    console.warn(`   Warning: Requested ${count} candles but only got ${candles.length}`);
  }
  
  // Return the most recent 'count' candles (or all if less than count)
  return candles.slice(-count);
}

// ==================== Fetch Historical Candles from Shoonya ====================
export async function fetchShoonyaHistoricalCandles(
  token = NIFTY_TOKEN, 
  exchange = NIFTY_EXCHANGE, 
  intervalMin = INTERVAL_MINUTES, 
  bars = 50
): Promise<Candle[]> {
  try {
    console.log(`   Requesting ${bars} candles for NIFTY 50 (${exchange}|${token}) at ${intervalMin}m interval...`);
    
    const { rest_authenticate } = await import('../utils/auth');
    const config = {
      id: process.env.ID || "",
      password: process.env.PASSWORD || "",
      api_key: process.env.API_KEY || "",
      vendor_key: process.env.VENDOR_KEY || "",
      imei: process.env.IMEI || "",
      topt: process.env.TOTP || "",
    };
    
    const sessionToken = await rest_authenticate(config);
    
    const Config = (await import('../config/config')).default;
    const conf = new Config();
    
    // Calculate last exchange working day (skip weekends)
    const now = DateTime.now().setZone('Asia/Kolkata');
    let lastTradingDay = now;
    
    // Go back to last weekday (Mon-Fri)
    while (lastTradingDay.weekday > 5) { // 6=Saturday, 7=Sunday
      lastTradingDay = lastTradingDay.minus({ days: 1 });
    }
    
    // If current time is during trading hours (9:15 AM - 3:30 PM), use current time
    // Otherwise use previous trading day's close
    let endDateTime: DateTime;
    const currentHour = now.hour;
    const currentMinute = now.minute;
    const currentTimeInMinutes = currentHour * 60 + currentMinute;
    const marketOpen = 9 * 60 + 15; // 9:15 AM
    const marketClose = 15 * 60 + 30; // 3:30 PM
    
    if (now.weekday <= 5 && currentTimeInMinutes >= marketOpen && currentTimeInMinutes <= marketClose) {
      // During trading hours - use current time rounded down to nearest interval
      const minutesSinceMarketOpen = currentTimeInMinutes - marketOpen;
      const intervalsCompleted = Math.floor(minutesSinceMarketOpen / intervalMin);
      const roundedMinutes = marketOpen + (intervalsCompleted * intervalMin);
      const roundedHour = Math.floor(roundedMinutes / 60);
      const roundedMinute = roundedMinutes % 60;
      endDateTime = now.set({ hour: roundedHour, minute: roundedMinute, second: 0, millisecond: 0 });
      console.log(`   Fetching candles up to current time: ${endDateTime.toFormat('yyyy-MM-dd HH:mm:ss')} IST`);
    } else {
      // Outside trading hours - use last market close
      endDateTime = lastTradingDay.set({ hour: 15, minute: 30, second: 0, millisecond: 0 });
      console.log(`   Fetching candles up to last market close: ${endDateTime.toFormat('yyyy-MM-dd HH:mm:ss')} IST`);
    }
    
    const endTime = Math.floor(endDateTime.toSeconds());
    
    // Request more time range to ensure we get enough candles (accounting for market hours)
    // Each trading day has ~6.25 hours = 75 candles of 5min
    const daysNeeded = Math.ceil(bars / 75) + 5; // Extra buffer for holidays
    const startDateTime = endDateTime.minus({ days: daysNeeded });
    const startTime = Math.floor(startDateTime.toSeconds());
    
    const payload = `jData=${JSON.stringify({
      uid: config.id,
      exch: exchange,
      token: token,
      st: startTime.toString(),
      et: endTime.toString(),
      intrv: intervalMin.toString()
    })}&jKey=${sessionToken}`;
    
    const axios = (await import('axios')).default;
    const response = await axios.post(`${conf.BASE_URL}/TPSeries`, payload, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    
    console.log(`   Shoonya response status: ${response.status}`);
    
    // Check if response has error (common during non-trading hours or weekends)
    if (response.data && typeof response.data === 'object' && response.data.stat === 'Not_Ok') {
      const errorMsg = response.data.emsg || 'Unknown error';
      console.log(`   Shoonya API: ${errorMsg} (This is normal during weekends/holidays)`);
      return [];
    }
    
    if (response.data && Array.isArray(response.data)) {
      const candles = response.data.map((candle: any) => {
        // Shoonya time format: "DD-MM-YYYY HH:MM:SS" or epoch seconds
        let timestamp: number;
        if (typeof candle.time === 'string' && candle.time.includes('-')) {
          // Parse DD-MM-YYYY HH:MM:SS format
          const parts = candle.time.split(' ');
          const dateParts = parts[0].split('-');
          const timeParts = parts[1]?.split(':') || ['00', '00', '00'];
          const dateObj = new Date(
            parseInt(dateParts[2]), // year
            parseInt(dateParts[1]) - 1, // month (0-indexed)
            parseInt(dateParts[0]), // day
            parseInt(timeParts[0]), // hour
            parseInt(timeParts[1]), // minute
            parseInt(timeParts[2]) // second
          );
          timestamp = dateObj.getTime();
        } else {
          // Assume epoch seconds
          timestamp = parseInt(candle.time) * 1000;
        }
        
        return {
          time: timestamp,
          open: parseFloat(candle.into),
          high: parseFloat(candle.inth),
          low: parseFloat(candle.intl),
          close: parseFloat(candle.intc),
          volume: parseInt(candle.v || candle.intv || 0)
        };
      }).filter(c => !isNaN(c.open) && !isNaN(c.close) && c.time > 100000000);
      
      console.log(`   Received ${candles.length} valid candles from Shoonya API`);
      
      // Sort candles by time (ascending - oldest first)
      candles.sort((a, b) => a.time - b.time);
      
      if (candles.length > 0) {
        console.log(`   First candle: ${new Date(candles[0].time).toISOString()}`);
        console.log(`   Last candle: ${new Date(candles[candles.length - 1].time).toISOString()}`);
        
        // Verify we got candles up to market close on last trading day
        const lastCandleDate = new Date(candles[candles.length - 1].time);
        const istLastCandle = DateTime.fromJSDate(lastCandleDate, { zone: 'Asia/Kolkata' });
        console.log(`   Last candle in IST: ${istLastCandle.toFormat('dd/MM/yyyy HH:mm:ss')}`);
      }
      
      if (candles.length < bars) {
        console.warn(`   Warning: Requested ${bars} candles but only got ${candles.length}`);
      }
      
      // Return the most recent 'bars' candles
      return candles.slice(-bars);
    }
    
    console.error(`   Shoonya API returned no data or invalid format. Data: ${JSON.stringify(response.data).substring(0, 200)}`);
    return [];
  } catch (err: any) {
    console.error('   Error fetching Shoonya historical candles:', err.message || err);
    return [];
  }
}

// ==================== Update Hybrid Candle from Shoonya LTP ====================
export function updateHybridCandleFromShoonyaLTP(ltp: number, intervalMin = INTERVAL_MINUTES): void {
  const intervalMs = intervalMin * 60 * 1000;
  const now = Date.now();
  
  // Get current time in IST
  const istTime = DateTime.fromMillis(now, { zone: 'Asia/Kolkata' });
  const marketClose = istTime.set({ hour: 15, minute: 30, second: 0, millisecond: 0 });
  
  // Get configurable candle start time
  const { hour, minute } = getCandleStartTime();
  const candleStartTime = istTime.set({ hour, minute, second: 0, millisecond: 0 });
  
  // Only build candles during configured hours (candle start time - 3:30 PM IST)
  if (istTime < candleStartTime || istTime > marketClose) {
    return; // Ignore LTP updates outside candle building hours
  }
  
  // Align candle time to configured start time intervals
  const candleStartMs = candleStartTime.toMillis();
  const elapsedSinceStart = now - candleStartMs;
  const candleIndex = Math.floor(elapsedSinceStart / intervalMs);
  const alignedCandleTime = candleStartMs + (candleIndex * intervalMs);
  
  let candle = hybridCandles[hybridCandles.length - 1];
  
  if (!candle || candle.time < alignedCandleTime) {
    // Start new candle aligned to market intervals (starting from 9:15 AM)
    const newCandle: Candle = {
      open: ltp,
      high: ltp,
      low: ltp,
      close: ltp,
      volume: 0,
      time: alignedCandleTime
    };
    hybridCandles.push(newCandle);
    if (hybridCandles.length > 500) hybridCandles.shift();
    lastCandleTime = alignedCandleTime;
    
    // New candle created (logging disabled for cleaner output)
  } else {
    // Update current candle
    candle.high = Math.max(candle.high, ltp);
    candle.low = Math.min(candle.low, ltp);
    candle.close = ltp;
  }
}

// ==================== Candle Management Functions ====================
export function getHybridCandles(): Candle[] {
  return hybridCandles;
}

export function setHybridCandles(candles: Candle[]): void {
  hybridCandles = candles;
  if (candles.length > 0) {
    lastCandleTime = candles[candles.length - 1].time;
  }
}

export function getLastCandleTime(): number | null {
  return lastCandleTime;
}

export function clearHybridCandles(): void {
  hybridCandles = [];
  lastCandleTime = null;
}
