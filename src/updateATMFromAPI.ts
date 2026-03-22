import fs from 'fs';
import path from 'path';
import { getQuotes } from './services/stocks/stocklist';
import { MORNING_STRATEGY_CONFIG } from './strategies/config/morning-strategy-config';

async function getNiftySpotPrice(): Promise<number> {
  try {
    // NIFTY 50 index on NSE - Token is 26000
    const quote = await getQuotes({ exch: 'NSE', token: '26000' });
    
    if (quote && quote.lp) {
      const price = parseFloat(quote.lp);
      if (!isNaN(price)) {
        return price;
      }
    }
    
    throw new Error('Could not extract price from quote response');
  } catch (error: any) {
    console.error('Error fetching NIFTY spot price:', error.message);
    throw error;
  }
}

async function main() {
  try {
    // Get current NIFTY spot price from Shoonya API
    console.log('Fetching current NIFTY spot price from Shoonya API...');
    const spotPrice = await getNiftySpotPrice();
    console.log('Current NIFTY spot price:', spotPrice);

    // Read NFO_symbols.txt from src directory
    const filePath = path.join(__dirname, '..', 'src', 'NFO_symbols.txt');
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim() !== '');

    if (lines.length < 2) {
      console.error('Invalid file format');
      process.exit(1);
    }

    const headers = lines[0].split(',').map(h => h.trim());
    const allRecords = lines.slice(1).map(line => {
      const values = line.split(',');
      const record: any = {};
      headers.forEach((header, index) => {
        record[header] = values[index]?.trim() || '';
      });
      return record;
    });

    console.log('Loaded', allRecords.length, 'total NFO instruments');

    // Filter for NIFTY 50 options and determine the latest upcoming expiry
    const { DateTime } = require('luxon');
    const todayIST = DateTime.now().setZone('Asia/Kolkata').startOf('day');

    // Helper to parse an instrument's expiry into a DateTime (start of day)
    const parseExpiry = (raw: any) => {
      if (!raw) return null;
      let expiryDate = DateTime.fromFormat(String(raw).trim(), 'dd-LLL-yyyy', {
        zone: 'Asia/Kolkata',
        locale: 'en',
      });
      if (!expiryDate.isValid) {
        expiryDate = DateTime.fromISO(String(raw), { zone: 'Asia/Kolkata' });
      }
      if (!expiryDate.isValid) return null;
      return expiryDate.startOf('day');
    };

    // First collect all NIFTY OPTIDX records and their expiries
    const niftyOptions = allRecords.filter((inst: any) => {
      const sym = (inst.Symbol || '').toUpperCase();
      const tsym = (inst.TradingSymbol || '').toUpperCase();
      const instrument = (inst.Instrument || '').toUpperCase();
      
      if (instrument !== 'OPTIDX') return false;
      if (sym !== 'NIFTY') return false;
      if (!tsym.startsWith('NIFTY') || !/^NIFTY\d/.test(tsym)) return false;
      if (tsym.includes('BANK') || sym.includes('BANK')) return false;
      return true;
    });

    const expiryIsoSet = new Set<string>();
    niftyOptions.forEach((inst: any) => {
      const ex = inst.Expiry || inst.expiry || inst.ExpiryDate;
      const dt = parseExpiry(ex);
      if (dt) {
        expiryIsoSet.add(dt.toISODate());
      }
    });

    const uniqueExpiries = Array.from(expiryIsoSet)
      .map(d => DateTime.fromISO(d, { zone: 'Asia/Kolkata' }))
      .sort((a, b) => a.toMillis() - b.toMillis());

    if (uniqueExpiries.length === 0) {
      throw new Error('No NIFTY option expiries found in symbol master');
    }

    // Latest upcoming expiry = first expiry >= today
    const currentExpiry = uniqueExpiries.find(d => d >= todayIST);
    if (!currentExpiry) {
      throw new Error('No upcoming NIFTY option expiries found');
    }

    let targetExpiry = currentExpiry;
    const currentIso = currentExpiry.toISODate();
    const todayIso = todayIST.toISODate();

    if (currentIso === todayIso) {
      // Today is an expiry date: use the next upcoming expiry if available
      const nextExpiry = uniqueExpiries.find(d => d > currentExpiry);
      if (nextExpiry) {
        targetExpiry = nextExpiry;
        console.log('📅 Today is expiry - using next upcoming expiry:', targetExpiry.toISODate());
      } else {
        console.log('📅 Today is expiry and no later expiries found; using today\'s expiry:', currentIso);
      }
    } else {
      console.log('Filtering for latest upcoming expiry:', currentIso);
    }

    const targetExpiryISO = targetExpiry.toISODate();

    const nifty50Weekly = niftyOptions.filter((inst: any) => {
      const ex = inst.Expiry || inst.expiry || inst.ExpiryDate;
      const dt = parseExpiry(ex);
      if (!dt) return false;
      return dt.toISODate() === targetExpiryISO;
    });

    console.log('Filtered to', nifty50Weekly.length, 'NIFTY 50 target expiry options');

    // Find all available strikes
    const allStrikes = Array.from(new Set(nifty50Weekly.map((i: any) => parseFloat(i.StrikePrice)).filter(Boolean))).sort((a, b) => a - b);
    
    // Round spot price to nearest 50 (NIFTY strikes are typically in 50s)
    const atmStrike = Math.round(spotPrice / 50) * 50;
    console.log('ATM strike (rounded to nearest 50):', atmStrike);

    // Select strikes around ATM based on configurable range
    const atmRange = MORNING_STRATEGY_CONFIG.ATM_RANGE;
    console.log(`Selecting strikes within ATM range ±${atmRange} steps`);
    
    const atmIndex = allStrikes.findIndex(s => s >= atmStrike);
    
    if (atmIndex === -1) {
      throw new Error('Could not find strikes near ATM price');
    }
    
    const startIdx = Math.max(0, atmIndex - atmRange);
    const endIdx = Math.min(allStrikes.length, atmIndex + atmRange + 1);
    const selectedStrikes = allStrikes.slice(startIdx, endIdx);
    
    console.log('Selected', selectedStrikes.length, 'strikes:', selectedStrikes[0], 'to', selectedStrikes[selectedStrikes.length - 1]);

    // Filter instruments to selected strikes
    const filtered = nifty50Weekly.filter((inst: any) => {
      const strike = parseFloat(inst.StrikePrice);
      return selectedStrikes.includes(strike);
    });

    console.log('Filtered to', filtered.length, 'ATM-focused instruments');

    // Save
    const output = { NFO: filtered };
    const outputPath = path.join(__dirname, '..', 'src', 'merged_instruments.json');
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log('✓ Updated merged_instruments.json with', filtered.length, 'instruments');

    // Breakdown
    const byExpiry: Record<string, number> = {};
    filtered.forEach((inst: any) => {
      const key = inst.Expiry + ' ' + inst.OptionType;
      byExpiry[key] = (byExpiry[key] || 0) + 1;
    });
    console.log('Breakdown:', byExpiry);
  } catch (error: any) {
    console.error('Error updating ATM instruments:', error.message || error);
    throw error;
  }
}

// Export for use in index.ts
export { main as updateATMInstruments };

// Run directly if executed as script
if (require.main === module) {
  main().catch((err: any) => {
    console.error('Fatal error in updateATMFromAPI:', err);
    process.exit(1);
  });
}
