import { setTimeout } from 'timers/promises';
import { getStockList, getQuotes } from '../services/stocks/stocklist';
import { getRecentBars } from '../services/stocks/yahoo';
import { calculateRSI, calculateEMA } from './lib/indicators';
import { handleBullishSignal } from './scenarios/bullish';
import { handleBearishSignal } from './scenarios/bearish';
import { placeEntryAndGTT as placeEntryAndGTTHandler, cancelGttAndSquareOff } from './lib/order-handler';


// Strategy config
const RSI_LENGTH = 14;
const RSI_EMA_LENGTH = 21;
const INTERVAL_MINUTES = 5; // 5 minute bars
const SYMBOL = '^NSEI'; // Yahoo symbol for NIFTY 50 index
const EXCHANGE = 'NFO';
const SEARCH_QUERY = 'NIFTY';
const TARGET_PREMIUM = 180; // near 180 rupees premium
const TARGET_PERCENT = 0.2; // +20% profit target
const STOP_PERCENT = 0.05; // -5% stop loss
// Live trading only. Ensure Shoonya credentials and TOTP are configured via environment variables.


// Fetch recent bars using the yahoo service
async function fetchRecentBars(symbol: string, period = '5m', count = 500) {
  return getRecentBars(symbol, period, count);
}

async function findOptionNearPremium(optionType: 'CE' | 'PE', premiumTarget = TARGET_PREMIUM) {
  // fetch option instruments for NIFTY
  const now = new Date();
  // First fetch all options for the query to determine the nearest expiry
  const listResp = await getStockList({ query: SEARCH_QUERY, exchange: EXCHANGE, optionType });
  if (listResp.stat !== 'Ok' || !Array.isArray(listResp.values)) {
    console.error('Failed to fetch option chain from StockList');
    return null;
  }

  // Filter by upcoming expiry (first expiry date)
  const instruments = listResp.values.map((v: any) => ({ ...v }));
  instruments.sort((a: any, b: any) => {
    const da = new Date(a.Expiry || a.expiry || a.ExpiryDate || 0).getTime() || 0;
    const db = new Date(b.Expiry || b.expiry || b.ExpiryDate || 0).getTime() || 0;
    return da - db;
  });

  const upcomingExpiry = instruments.find((i: any) => new Date(i.Expiry || i.expiry || i.ExpiryDate).getTime() > now.getTime());
  const expiry = upcomingExpiry ? upcomingExpiry.Expiry || upcomingExpiry.expiry || upcomingExpiry.ExpiryDate : null;

  // Restrict to instruments of the identified upcoming expiry only by re-querying getStockList
  let restrictedListResp = listResp;
  if (expiry) {
    try {
      const expiryDateObj = new Date(expiry);
      const expiryMonth = expiryDateObj.toLocaleString('default', { month: 'short' });
      const expiryYear = String(expiryDateObj.getFullYear());
      restrictedListResp = await getStockList({ query: SEARCH_QUERY, exchange: EXCHANGE, optionType, expiryMonth, expiryYear });
    } catch (e) {
      console.warn('Failed to re-query stock list with expiry filters, falling back to initial list', e);
    }
  }

    const candidates = (restrictedListResp.values || instruments).filter((i: any) => {
    if (!expiry) return false;
    const ex = i.Expiry || i.expiry || i.ExpiryDate;
    if (!ex) return false;
    if (String(ex) !== String(expiry)) return false;
    if ((i.OptionType || i.Option) && i.OptionType !== optionType) return false;
    return true;
  });

      // Ensure instruments are strictly NIFTY options and on the NFO exchange
      const filteredByExchangeAndSymbol = candidates.filter((i: any) => {
        const exch = (i.Exch || i.exch || i.Exchange || i.exchange || '').toUpperCase();
        if (exch && exch !== 'NFO') return false;
        const tsym = (i.TradingSymbol || i.Symbol || '').toUpperCase();
        if (!/NIFTY(?:\s|$|\d)/.test(tsym)) return false;
        // Exclude BankNifty or other indices explicitly
        if (tsym.includes('BANK') || tsym.includes('BANKNIFTY')) return false;
        return true;
      });

      if (filteredByExchangeAndSymbol.length === 0) {
        console.error('No option instruments found for current expiry on NFO for NIFTY');
        return null;
      }

      // Use the filtered candidates for next steps
      const finalCandidates = filteredByExchangeAndSymbol;

    // already validated by filteredByExchangeAndSymbol above

  // collect unique strikes and limit the set for performance
      const strikes = Array.from(new Set(finalCandidates.map((c: any) => Number(c.StrikePrice) || Number(c.Strike) || 0))).filter(Boolean).sort((a, b) => a - b);
  if (strikes.length === 0) {
    console.error('No strikes found in candidates');
    return null;
  }

  // pick a reasonable subset centered on ATM for performance
  const mid = Math.floor(strikes.length / 2);
  const windowSize = Math.min(40, strikes.length);
  const start = Math.max(0, mid - Math.floor(windowSize / 2));
  const selectedStrikes = strikes.slice(start, start + windowSize);

  let best: { instrument: any; ltp: number } | null = null;
  for (const s of selectedStrikes) {
    const inst = finalCandidates.find((c: any) => Number(c.StrikePrice) === s);
    if (!inst) continue;
    const token = inst.Token || inst.TokenNo || inst.TokenId || inst.InstrumentToken || inst.TradingSymbol;
    try {
      const quote = await getQuotes({ exch: EXCHANGE, token: String(token) });
      const ltp = Number(quote.ltp ?? quote.LTP ?? quote.last_price ?? quote.lastPrice ?? quote.last ?? 0);
      if (!best || Math.abs(ltp - premiumTarget) < Math.abs(best.ltp - premiumTarget)) {
        best = { instrument: inst, ltp };
      }
    } catch (e) {
      // ignore failures for specific strikes
      console.warn('Failed to fetch quote for strike', s, e);
    }
  }

  if (!best) {
    console.error('Could not find option with LTP near target premium');
    return null;
  }

  return best;
}


async function main() {
  console.log('Starting NIFTY RSI strategy');
  console.warn('LIVE MODE: Orders will be placed. Ensure credentials in .env are correct.');

  // Attempt to fetch recent 5m bars; if none available, retry with backoff instead of exiting
  let bars: any[] = [];
  let attempt = 0;
  const maxAttempts = 12; // ~6 minutes if 30s sleep, or until we get data
  const baseSleep = 30 * 1000;
  while (true) {
    bars = await fetchRecentBars(SYMBOL, '5m', 500);
    if (bars && bars.length > 0) break;
    attempt++;
    const wait = Math.min(baseSleep * Math.pow(2, Math.max(0, attempt - 1)), 2 * 60 * 1000); // exponential backoff, max 2m
    console.warn(`No historical data found; retrying in ${wait / 1000}s (attempt ${attempt}/${maxAttempts})`);
    await setTimeout(wait);
    if (attempt >= maxAttempts) {
      console.error('Exceeded max retries for fetching historical bars; will continue to attempt on a schedule.');
      break;
    }
  }
  // get close price array
  const closes: number[] = bars.map((b: any) => b.close);
  let rsis = calculateRSI(closes, RSI_LENGTH);
  // Align lengths
  const rsiFull = Array(closes.length - rsis.length).fill(NaN).concat(rsis);
  const rsiEma = calculateEMA(rsiFull, RSI_EMA_LENGTH);

  let currentPosition: any = null;

  // initial print
  const lastRsi = rsiFull[rsiFull.length - 1];
  const lastRsiEma = rsiEma[rsiEma.length - 1];
  console.log(`RSI=${lastRsi}`);
  console.log(`RSI_EMA=${lastRsiEma}`);

  function msToNextInterval(intervalMinutes: number) {
    const intervalMs = intervalMinutes * 60 * 1000;
    const nowMs = Date.now();
    const nextMs = Math.ceil(nowMs / intervalMs) * intervalMs;
    return Math.max(0, nextMs - nowMs);
  }

  // Wait till the next 5-minute boundary before entering the main loop
  const initialWait = msToNextInterval(INTERVAL_MINUTES);
  console.log(`Waiting ${initialWait}ms until next ${INTERVAL_MINUTES}-minute boundary`);
  // Small buffer to allow external APIs to settle for the completed candle
  await setTimeout(initialWait + 2000);

  // Poll every 5 minutes aligned to system clock boundaries
  while (true) {
    try {
      // Fetch latest 5-minute bars aligned to the boundary
      bars = await fetchRecentBars(SYMBOL, '5m', 500);
      if (!bars || bars.length === 0) {
        console.warn('No 5m bars available');
      } else {
          const closesNew = bars.map((b: any) => b.close);
          const rsisNew = calculateRSI(closesNew, RSI_LENGTH);
          const rsiFullNew = Array(closesNew.length - rsisNew.length).fill(NaN).concat(rsisNew);
          const rsiEmaNew = calculateEMA(rsiFullNew, RSI_EMA_LENGTH);

          const prevIndex = rsiFullNew.length - 2;
          const curIndex = rsiFullNew.length - 1;
          const prevRsi = rsiFullNew[prevIndex];
          const prevRsiEma = rsiEmaNew[prevIndex];
          const curRsi = rsiFullNew[curIndex];
          const curRsiEma = rsiEmaNew[curIndex];

          console.log(`[5m] ${new Date().toISOString()} RSI=${curRsi} RSI_EMA=${curRsiEma}`);

          // Signal detection based on 5-minute bars
          const bullishCross = prevRsi < prevRsiEma && curRsi > curRsiEma;
          const bearishCross = prevRsi > prevRsiEma && curRsi < curRsiEma;

          if (bullishCross && curRsi > curRsiEma) {
            const newPos = await handleBullishSignal(currentPosition, findOptionNearPremium, placeEntryAndGTTHandler, TARGET_PREMIUM, TARGET_PERCENT, STOP_PERCENT);
            if (newPos) currentPosition = newPos;
          }

          if (bearishCross && curRsi < curRsiEma) {
            const newPos = await handleBearishSignal(currentPosition, findOptionNearPremium, placeEntryAndGTTHandler, TARGET_PREMIUM, TARGET_PERCENT, STOP_PERCENT);
            if (newPos) currentPosition = newPos;
          }

          // Check for exit conditions: opposite crosses
          if (currentPosition) {
            if (currentPosition.type === 'CE' && bearishCross) {
              console.log('CE position exists and bearish cross detected; canceling GTT and squaring off');
              await cancelGttAndSquareOff(currentPosition).catch(console.error);
              currentPosition = null;
            }
            if (currentPosition.type === 'PE' && bullishCross) {
              console.log('PE position exists and bullish cross detected; canceling GTT and squaring off');
              await cancelGttAndSquareOff(currentPosition).catch(console.error);
              currentPosition = null;
            }
          }
        }
      const closesNew = bars.map((b: any) => b.close);
      const rsisNew = calculateRSI(closesNew, RSI_LENGTH);
      const rsiFullNew = Array(closesNew.length - rsisNew.length).fill(NaN).concat(rsisNew);
      const rsiEmaNew = calculateEMA(rsiFullNew, RSI_EMA_LENGTH);

      const prevIndex = rsiFullNew.length - 2;
      const curIndex = rsiFullNew.length - 1;
      const prevRsi = rsiFullNew[prevIndex];
      const prevRsiEma = rsiEmaNew[prevIndex];
      const curRsi = rsiFullNew[curIndex];
      const curRsiEma = rsiEmaNew[curIndex];

      console.log(`RSI=${curRsi}`);
      console.log(`RSI_EMA=${curRsiEma}`);

      // Signal detection
      const bullishCross = prevRsi < prevRsiEma && curRsi > curRsiEma;
      const bearishCross = prevRsi > prevRsiEma && curRsi < curRsiEma;

      if (bullishCross && curRsi > curRsiEma) {
        // Delegate to bullish scenario handler
        const newPos = await handleBullishSignal(currentPosition, findOptionNearPremium, placeEntryAndGTTHandler, TARGET_PREMIUM, TARGET_PERCENT, STOP_PERCENT);
        if (newPos) currentPosition = newPos;
      }

      if (bearishCross && curRsi < curRsiEma) {
        // Delegate to bearish scenario handler
        const newPos = await handleBearishSignal(currentPosition, findOptionNearPremium, placeEntryAndGTTHandler, TARGET_PREMIUM, TARGET_PERCENT, STOP_PERCENT);
        if (newPos) currentPosition = newPos;
      }

      // Check for exit conditions: opposite crosses
      if (currentPosition) {
          if (currentPosition.type === 'CE' && bearishCross) {
          console.log('CE position exists and bearish cross detected; canceling GTT and squaring off');
          await cancelGttAndSquareOff(currentPosition).catch(console.error);
          currentPosition = null;
        }
        if (currentPosition.type === 'PE' && bullishCross) {
          console.log('PE position exists and bullish cross detected; canceling GTT and squaring off');
          await cancelGttAndSquareOff(currentPosition).catch(console.error);
          currentPosition = null;
        }
      }
      // After processing, wait until the next 5-minute boundary
      const waitMs = msToNextInterval(INTERVAL_MINUTES);
      await setTimeout(waitMs + 2000);
    } catch (err) {
      console.error('Error in main loop:', err);
      // If an error occurs, wait a short time before retrying aligned to boundary
      await setTimeout(5000);
      const retryWait = msToNextInterval(INTERVAL_MINUTES);
      await setTimeout(retryWait + 1000);
    }
  }
}
//start of strategy
export async function startNiftyRsiStrategy() {
  try {
    await main();
  } catch (err) {
    console.error('NIFTY RSI Strategy failed:', err);
  }
}

// If run directly, start immediately
if (require.main === module) {
  startNiftyRsiStrategy();
}

