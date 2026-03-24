import fs from 'fs';
import path from 'path';
import { getQuotes } from './stocklist';
import { updateATMInstruments } from '../../updateATMFromAPI';

interface InstrumentRecord {
  Exchange: string;
  Token: string;
  Symbol: string;
  TradingSymbol: string;
  Expiry: string;
  Instrument: string;
  OptionType: string;
  StrikePrice: string;
  [key: string]: any;
}

interface MergedInstrumentsFile {
  NFO?: InstrumentRecord[];
  [key: string]: any;
}

export interface PremiumFilterConfig {
  minPremium: number;
  maxPremium: number;
}

// Path to merged_instruments.json used by other services (relative to this file)
const MERGED_INSTRUMENTS_PATH = path.resolve(__dirname, '../../merged_instruments.json');

export async function refreshMergedInstrumentsByPremium(config: PremiumFilterConfig): Promise<void> {
  const { minPremium, maxPremium } = config;

  if (!Number.isFinite(minPremium) || !Number.isFinite(maxPremium) || minPremium <= 0 || maxPremium <= 0 || minPremium >= maxPremium) {
    console.warn('Invalid premium range for instrument refresh; skipping refresh.', { minPremium, maxPremium });
    return;
  }

  // Always refresh merged_instruments.json from live ATM data before applying
  // the premium filter so we work on the latest instruments snapshot.
  try {
    await updateATMInstruments();
  } catch (err) {
    console.error('Failed to update instruments via updateATMFromAPI before premium filter:', err);
  }

  if (!fs.existsSync(MERGED_INSTRUMENTS_PATH)) {
    console.warn('merged_instruments.json not found; skipping premium-based refresh.');
    return;
  }

  let fileData: MergedInstrumentsFile;
  try {
    const raw = await fs.promises.readFile(MERGED_INSTRUMENTS_PATH, 'utf8');
    fileData = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to read/parse merged_instruments.json for premium refresh:', err);
    return;
  }

  const instruments = Array.isArray(fileData.NFO) ? fileData.NFO : [];
  if (instruments.length === 0) {
    console.warn('No NFO instruments found in merged_instruments.json; nothing to refresh.');
    return;
  }

  console.log(`\n🔄 Refreshing merged_instruments.json based on live premiums in range [${minPremium}, ${maxPremium}]...`);

  const filtered: InstrumentRecord[] = [];

  for (const inst of instruments) {
    const exch = inst.Exchange;
    const token = inst.Token;

    if (!exch || !token) {
      continue;
    }

    try {
      const quote: any = await getQuotes({ exch, token });

      if (!quote || quote.stat === 'Not_Ok') {
        continue;
      }

      const rawLtp =
        quote.ltp ??
        quote.lp ??
        quote.LTP ??
        quote.last_price ??
        quote.lastPrice ??
        quote.last ??
        quote.lastTradedPrice ??
        quote.LastTradedPrice;

      const ltp = typeof rawLtp === 'number' ? rawLtp : Number.parseFloat(String(rawLtp));
      if (!Number.isFinite(ltp)) {
        continue;
      }

      if (ltp >= minPremium && ltp <= maxPremium) {
        filtered.push(inst);
      }
    } catch (err) {
      // Ignore individual quote errors and continue with remaining instruments
      continue;
    }
  }

  console.log(`Premium filter kept ${filtered.length} instruments out of ${instruments.length}.`);

  const updated: MergedInstrumentsFile = {
    ...fileData,
    NFO: filtered,
  };

  try {
    await fs.promises.writeFile(MERGED_INSTRUMENTS_PATH, JSON.stringify(updated, null, 2));
    console.log(`✅ Updated merged_instruments.json with premium-filtered instruments.`);
  } catch (err) {
    console.error('Failed to write updated merged_instruments.json after premium refresh:', err);
  }
}
