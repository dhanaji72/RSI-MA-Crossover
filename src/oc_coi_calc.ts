import { fetch as undiciFetch } from "undici";
import { CookieJar } from "tough-cookie";
import fetchCookie from "fetch-cookie";
import { DateTime } from "luxon";
import { getStockList, getQuotes } from "./services/stocks/stocklist";
import { placeEntryAndGTT } from "./strategies/lib/order-handler";

const TZ = "Asia/Kolkata";

// ---------- Types ----------
type Leg = {
  changeinOpenInterest?: number; // NSE field
};

type StrikeRow = {
  strikePrice: number;
  CE?: Leg;
  PE?: Leg;
};

type OptionChainResponse = {
  records?: {
    underlyingValue?: number; // spot/underlying
    data?: StrikeRow[];
  };
};

// ---------- NSE Fetch with cookies ----------
const jar = new CookieJar();
const fetch = fetchCookie(undiciFetch as any, jar) as typeof undiciFetch;

async function warmUpCookies() {
  await fetch("https://www.nseindia.com/option-chain", {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    },
  });
}

async function fetchOptionChain(symbol = "NIFTY"): Promise<OptionChainResponse> {
  const url = `https://www.nseindia.com/api/option-chain-indices?symbol=${encodeURIComponent(symbol)}`;

  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
      accept: "application/json,text/plain,*/*",
      "accept-language": "en-US,en;q=0.9",
      referer: "https://www.nseindia.com/option-chain",
      connection: "keep-alive",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`NSE HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  return (await res.json()) as OptionChainResponse;
}

// ---------- Strategy utilities ----------
function nearestStrike(strikes: number[], underlyingValue: number): number {
  let best = strikes[0];
  let bestDiff = Math.abs(best - underlyingValue);
  for (const s of strikes) {
    const d = Math.abs(s - underlyingValue);
    if (d < bestDiff) {
      best = s;
      bestDiff = d;
    }
  }
  return best;
}

function calc3StrikeTotals(oc: OptionChainResponse) {
  const rows = oc.records?.data ?? [];
  const spot = oc.records?.underlyingValue;

  if (!rows.length || typeof spot !== "number") return null;

  const sorted = [...rows].sort((a, b) => a.strikePrice - b.strikePrice);
  const strikes = sorted.map((r) => r.strikePrice);

  const atm = nearestStrike(strikes, spot);
  const atmIdx = strikes.indexOf(atm);

  const lower3 = sorted.slice(Math.max(0, atmIdx - 3), atmIdx);       // 3 below ATM
  const higher3 = sorted.slice(atmIdx + 1, atmIdx + 1 + 3);           // 3 above ATM

  const callCOI = lower3.reduce((s, r) => s + (r.CE?.changeinOpenInterest ?? 0), 0);
  const putCOI  = higher3.reduce((s, r) => s + (r.PE?.changeinOpenInterest ?? 0), 0);

  return {
    spot,
    atm,
    callCOI,
    putCOI,
    callStrikes: lower3.map((r) => r.strikePrice),
    putStrikes: higher3.map((r) => r.strikePrice),
  };
}

// ---------- Helpers: suggest strike and place orders ----------
const TARGET_PREMIUM = Number(process.env.TARGET_PREMIUM ?? 180);
const TARGET_PERCENT = Number(process.env.TARGET_PERCENT ?? 0.2);
const STOP_PERCENT = Number(process.env.STOP_PERCENT ?? 0.05);
const SIGNAL_CONFIRM_COUNT = Number(process.env.SIGNAL_CONFIRM_COUNT ?? 4);
const MAX_SNAPSHOTS = Number(process.env.MAX_SNAPSHOTS ?? 5);

async function findOptionNearPremium(optionType: 'CE' | 'PE', premiumTarget = TARGET_PREMIUM) {
  // simplified copy of logic from nifty-rsi-trader
  const SEARCH_QUERY = 'NIFTY';
  const EXCHANGE = 'NFO';
  const now = Date.now();
  const listResp = await getStockList({ query: SEARCH_QUERY, exchange: EXCHANGE, optionType });
  if (listResp.stat !== 'Ok' || !Array.isArray(listResp.values)) {
    console.warn('Could not fetch option chain to suggest strike');
    return null;
  }

  const instruments = listResp.values.map((v: any) => ({ ...v }));
  instruments.sort((a: any, b: any) => new Date(a.Expiry || a.expiry || a.ExpiryDate || 0).getTime() - new Date(b.Expiry || b.expiry || b.ExpiryDate || 0).getTime());
  const upcoming = instruments.find((i: any) => new Date(i.Expiry || i.expiry || i.ExpiryDate).getTime() > now);
  const expiry = upcoming ? (upcoming.Expiry || upcoming.expiry || upcoming.ExpiryDate) : null;
  // restrict instruments to expiry
  const candidates = instruments.filter((i: any) => {
    if (!expiry) return false;
    const ex = i.Expiry || i.expiry || i.ExpiryDate;
    if (!ex || String(ex) !== String(expiry)) return false;
    if ((i.OptionType || i.Option) && i.OptionType !== optionType) return false;
    const exch = (i.Exch || i.exch || i.Exchange || i.exchange || '').toUpperCase();
    if (exch && exch !== 'NFO') return false;
    const tsym = (i.TradingSymbol || i.Symbol || '').toUpperCase();
    if (!/NIFTY(?:\s|$|\d)/.test(tsym)) return false;
    if (tsym.includes('BANK') || tsym.includes('BANKNIFTY')) return false;
    return true;
  });

  const strikes = Array.from(new Set(candidates.map((c: any) => Number(c.StrikePrice) || Number(c.Strike) || 0))).filter(Boolean).sort((a, b) => a - b);
  if (strikes.length === 0) return null;

  // pick a subset around mid for speed
  const mid = Math.floor(strikes.length / 2);
  const windowSize = Math.min(80, strikes.length);
  const start = Math.max(0, mid - Math.floor(windowSize / 2));
  const selectedStrikes = strikes.slice(start, start + windowSize);

  let best: { inst: any; ltp: number } | null = null;
  for (const s of selectedStrikes) {
    const inst = candidates.find((c: any) => Number(c.StrikePrice) === s);
    if (!inst) continue;
    const token = inst.Token || inst.TokenNo || inst.TokenId || inst.InstrumentToken || inst.TradingSymbol;
    try {
      const quote = await getQuotes({ exch: 'NFO', token: String(token) });
      const ltp = Number(quote.ltp ?? quote.LTP ?? quote.last_price ?? quote.lastPrice ?? quote.last ?? 0);
      if (!best || Math.abs(ltp - premiumTarget) < Math.abs(best.ltp - premiumTarget)) {
        best = { inst, ltp };
      }
    } catch (e) {}
  }

  return best;
}

// ---------- Streak state ----------
type Signal = "BUY_CALL" | "BUY_PUT" | "NO_TRADE";

type State = {
  lastSpot?: number;
  bullStreak: number;
  bearStreak: number;
  lastSignal?: Signal;
  signalCount?: number;
  lastPlacedSignal?: Signal;
  lastPlacedInstrument?: string;
};

function decideSignal(
  spotNow: number,
  spotPrev: number | undefined,
  bias: number,
  X: number,
  N: number,
  state: State
): Signal {
  // streak update
  if (bias > X) {
    state.bullStreak += 1;
    state.bearStreak = 0;
  } else if (bias < -X) {
    state.bearStreak += 1;
    state.bullStreak = 0;
  } else {
    state.bullStreak = 0;
    state.bearStreak = 0;
  }

  // price confirmation (simple): spot must move in direction vs previous snapshot
  const priceUp = spotPrev !== undefined && spotNow > spotPrev;
  const priceDown = spotPrev !== undefined && spotNow < spotPrev;

  if (state.bullStreak >= N && priceUp) return "BUY_CALL";
  if (state.bearStreak >= N && priceDown) return "BUY_PUT";
  return "NO_TRADE";
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function msToStartTime(startHHMM: string, zone = TZ): number {
  // parse strings like '09:19' or '09:19:00'
  const parts = startHHMM.split(":").map((p) => Number(p));
  const now = DateTime.now().setZone(zone);
  const hh = parts[0] ?? 0;
  const mm = parts[1] ?? 0;
  const ss = parts[2] ?? 0;
  const startToday = now.set({ hour: hh, minute: mm, second: ss, millisecond: 0 });
  if (startToday > now) {
    return startToday.toMillis() - now.toMillis();
  }
  return 0; // start immediately if we're already past the target time today
}

// ---------- Main loop ----------
async function main() {
  const symbol = process.env.SYMBOL ?? "NIFTY";

  // Strategy parameters (tune these)
  const N = Number(process.env.STREAK_N ?? 3); // 3 snapshots = ~9 minutes
  const X = Number(process.env.BIAS_X ?? 200000); // threshold; tune for NIFTY/BANKNIFTY

  const state: State = { bullStreak: 0, bearStreak: 0, signalCount: 0 };
  let snapshotCount = 0;

  await warmUpCookies();

  // Wait until market start snapshot time (default 09:19 Asia/Kolkata)
  const START_TIME = process.env.START_TIME ?? '09:16';
  const waitMs = msToStartTime(START_TIME, TZ);
  if (waitMs > 0) {
    console.log(`Waiting ${Math.ceil(waitMs/1000)}s until ${START_TIME} ${TZ} to begin snapshots`);
    await sleep(waitMs);
  } else {
    console.log(`Current time is past ${START_TIME} ${TZ}; starting snapshots immediately`);
  }

  // Compute scheduled end time from start + (MAX_SNAPSHOTS-1) * interval (3 minutes)
  const parts = START_TIME.split(":").map((p) => Number(p));
  const startTimeDT = DateTime.now().setZone(TZ).set({ hour: parts[0] ?? 0, minute: parts[1] ?? 0, second: parts[2] ?? 0, millisecond: 0 });
  const intervalMinutes = 3;
  const plannedEnd = startTimeDT.plus({ minutes: (MAX_SNAPSHOTS - 1) * intervalMinutes });
  console.log(`Planned snapshots at ${START_TIME} (start) through ${plannedEnd.toFormat('HH:mm')} (end) - total ${MAX_SNAPSHOTS} snapshots`);

  while (true) {
    const ts = DateTime.now().setZone(TZ).toFormat("yyyy-LL-dd HH:mm:ss");

    try {
      const oc = await fetchOptionChain(symbol);
      const t = calc3StrikeTotals(oc);

      if (!t) {
        console.log(`[${ts}] No data; skipping`);
      } else {
        const bias = t.putCOI - t.callCOI; // positive => put side stronger
        const signal = decideSignal(t.spot, state.lastSpot, bias, X, N, state);

        // Short summary per snapshot for quick console analysis
        console.log(`[${ts}] SNAPSHOT: Spot=${t.spot.toFixed(2)} ATM=${t.atm} CALL=${t.callCOI} PUT=${t.putCOI} BIAS=${bias} Streak=${state.bullStreak}/${state.bearStreak} SIG=${signal} CONF=${state.signalCount ?? 0} LAST_PL=${state.lastPlacedInstrument ?? 'none'}`);

        // Verbose detailed log (kept for debugging)
        console.log(
          `[${ts}] ${symbol} Spot=${t.spot.toFixed(2)} ATM=${t.atm} ` +
          `CALL_COI=${t.callCOI} (below: ${t.callStrikes.join(",")}) ` +
          `PUT_COI=${t.putCOI} (above: ${t.putStrikes.join(",")}) ` +
          `BIAS=${bias} Streak(Bull/Bear)=${state.bullStreak}/${state.bearStreak} ` +
          `=> SIGNAL=${signal}`
        );

        state.lastSpot = t.spot;

        // Optional: avoid repeating the same signal continuously and count confirmations
        if (signal === "NO_TRADE") {
          state.signalCount = 0;
        } else if (signal === state.lastSignal) {
          state.signalCount = (state.signalCount ?? 0) + 1;
        } else {
          state.signalCount = 1;
        }
        state.lastSignal = signal;

        // If signal is confirmed for configured polls, suggest strike and place order
        if (signal !== "NO_TRADE" && (state.signalCount ?? 0) >= SIGNAL_CONFIRM_COUNT && state.lastPlacedSignal !== signal) {
          (async () => {
            try {
              const optType = signal === 'BUY_CALL' ? 'CE' : 'PE';
              console.log(`Signal ${signal} confirmed ${state.signalCount} times. Searching for option near premium ₹${TARGET_PREMIUM}...`);
              const best = await findOptionNearPremium(optType, TARGET_PREMIUM);
              if (!best) {
                console.warn('No option found to place order for confirmed signal');
                return;
              }
              console.log(`Placing entry order for ${best.inst.TradingSymbol || best.inst.Symbol} LTP=₹${best.ltp}`);
              const placementSymbol = best.inst.TradingSymbol || best.inst.Symbol || String(best.inst.Token || best.inst.TokenNo || best.inst.TokenId || best.inst.InstrumentToken || '');
              if (state.lastPlacedInstrument && state.lastPlacedInstrument === placementSymbol) {
                console.log(`Already placed order for ${placementSymbol}; skipping duplicate`);
                return;
              }
              const res = await placeEntryAndGTT('buy', best.inst, best.ltp, TARGET_PERCENT, STOP_PERCENT);
              if (res) {
                console.log(`Placed order for ${best.inst.TradingSymbol || best.inst.Symbol}`, res);
                state.lastPlacedSignal = signal;
                state.lastPlacedInstrument = best.inst.TradingSymbol || best.inst.Symbol || String(best.inst.Token || best.inst.TokenNo || best.inst.TokenId || best.inst.InstrumentToken || '');
                state.signalCount = 0; // reset confirmation counter after placement
              }
            } catch (err) {
              console.error('Error placing order for confirmed signal:', err);
            }
          })();
        }
      }

      // Count snapshots irrespective of data availability
      snapshotCount += 1;
      console.log(`[${ts}] Snapshot ${snapshotCount}/${MAX_SNAPSHOTS}`);
      if (snapshotCount >= MAX_SNAPSHOTS) {
        console.log(`Reached ${MAX_SNAPSHOTS} snapshots; exiting.`);
        break;
      }
    } catch (e) {
      console.error(`[${ts}] Error:`, e);
      // NSE session might rotate; refresh cookies
      try { await warmUpCookies(); } catch {}
    }

    // every 3 minutes
    await sleep(3 * 60 * 1000);
  }
}

export async function startOcCoi() {
  return main();
}

if (require.main === module) {
  startOcCoi().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
