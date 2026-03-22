import axios from 'axios';

// Try multiple symbol variants on multiple providers (TwelveData, AlphaVantage)
async function fetchFromTwelve(symbol: string, interval = '5min', outputsize = 500, apiKey?: string) {
  if (!apiKey) return [];
  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}&format=json&apikey=${apiKey}`;
    const resp = await axios.get(url);
    if (resp.data && resp.data.values && Array.isArray(resp.data.values)) {
      return resp.data.values.map((v: any) => ({ date: new Date(v.datetime || v.timestamp), open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close), volume: Number(v.volume || 0) }));
    }
  } catch (e) {
    // ignore
  }
  return [];
}

async function fetchFromAlpha(symbol: string, interval = '5min', apiKey?: string) {
  if (!apiKey) return [];
  try {
    const func = 'TIME_SERIES_INTRADAY';
    const url = `https://www.alphavantage.co/query?function=${func}&symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=full&apikey=${apiKey}`;
    const resp = await axios.get(url);
    const key = Object.keys(resp.data).find((k) => k.toLowerCase().includes('time series'));
    if (!key) return [];
    const series = resp.data[key];
    const items = Object.keys(series).map((t) => ({ date: new Date(t), ...series[t] }));
    // sort by date ascending
    items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return items.map((v: any) => ({ date: new Date(v.date), open: Number(v['1. open']), high: Number(v['2. high']), low: Number(v['3. low']), close: Number(v['4. close']), volume: Number(v['5. volume'] || 0) }));
  } catch (e) {
    // ignore
  }
  return [];
}

export async function getIntradayBars(symbolVariants: string[], interval = '5min', count = 500) {
  const tdKey = process.env.TWELVE_DATA_API_KEY;
  const avKey = process.env.ALPHA_VANTAGE_API_KEY || process.env.ALPHAKEY;

  // Try TwelveData first if key present
  if (tdKey) {
    for (const s of symbolVariants) {
      const bars = await fetchFromTwelve(s, interval, count, tdKey);
      if (bars && bars.length) return bars.slice(-count);
    }
  }

  // Try AlphaVantage
  if (avKey) {
    for (const s of symbolVariants) {
      const bars = await fetchFromAlpha(s, interval, avKey);
      if (bars && bars.length) return bars.slice(-count);
    }
  }

  return [];
}

export default {
  getIntradayBars
};
