import { getStockList } from './services/stocks/stocklist';
import { DateTime } from 'luxon';
import fs from 'fs';
import path from 'path';

async function updateWeeklyInstruments() {
  if (process.env.DISABLE_INSTRUMENTS_UPDATE === 'true') {
    console.warn('Instrument update disabled via DISABLE_INSTRUMENTS_UPDATE. Skipping weekly instruments fetch.');
    return;
  }
  console.log('Fetching NIFTY current week expiry options from Shoonya API...');
  
  const todayIST = DateTime.now().setZone('Asia/Kolkata').startOf('day');
  
  // Find only the nearest Tuesday (current expiry)
  let currentExpiry: DateTime | null = null;
  for (let i = 0; i <= 14; i++) {
    const d = todayIST.plus({ days: i });
    if (d.weekday === 2) { // Tuesday
      currentExpiry = d;
      break;
    }
  }
  
  if (!currentExpiry) {
    throw new Error('Could not find nearest Tuesday expiry within 14 days');
  }
  
  console.log('Target expiry (current week Tuesday IST):', currentExpiry.toISODate());
  
  // Fetch CE and PE options for NIFTY
  const ceResponse = await getStockList({
    query: 'NIFTY',
    exchange: 'NFO',
    optionType: 'CE',
    weeklyOnly: true
  });
  
  const peResponse = await getStockList({
    query: 'NIFTY',
    exchange: 'NFO',
    optionType: 'PE',
    weeklyOnly: true
  });
  
  const allInstruments = [
    ...(ceResponse.values || []),
    ...(peResponse.values || [])
  ];
  
  console.log(`Fetched ${allInstruments.length} weekly NIFTY instruments`);
  
  // Strict filter: ONLY NIFTY 50 index options (exclude BANKNIFTY, stock options, etc.)
  const isNifty50Only = (inst: any) => {
    const sym = (inst.Symbol || '').toUpperCase();
    const tsym = (inst.TradingSymbol || '').toUpperCase();
    const instrument = (inst.Instrument || '').toUpperCase();
    
    // Must be OPTIDX (index options, not stock options)
    if (instrument !== 'OPTIDX') return false;
    
    // Symbol must be exactly "NIFTY" (not BANKNIFTY, FINNIFTY, MIDCPNIFTY, etc.)
    if (sym !== 'NIFTY') return false;
    
    // TradingSymbol must start with NIFTY and a digit (not BANKNIFTY, etc.)
    if (!tsym.startsWith('NIFTY') || !/^NIFTY\d/.test(tsym)) return false;
    
    // Exclude BANKNIFTY variants
    if (tsym.includes('BANK') || sym.includes('BANK')) return false;
    
    return true;
  };
  
  // Filter to match current expiry only AND NIFTY 50 only
  const filtered = allInstruments.filter((inst: any) => {
    // First check if it's NIFTY 50
    if (!isNifty50Only(inst)) return false;
    
    // Then check expiry - must match current expiry exactly
    const ex = inst.Expiry || inst.expiry || inst.ExpiryDate;
    if (!ex) return false;
    let dt = DateTime.fromFormat(String(ex).trim(), 'dd-LLL-yyyy', { zone: 'Asia/Kolkata', locale: 'en' });
    if (!dt.isValid) dt = DateTime.fromISO(String(ex), { zone: 'Asia/Kolkata' });
    if (!dt.isValid) return false;
    const iso = dt.startOf('day').toISODate();
    return iso === currentExpiry.toISODate();
  });
  
  console.log(`Filtered to ${filtered.length} instruments for current week expiry only`);
  
  // Create output structure matching original format
  const output = {
    NFO: filtered
  };
  
  // Write to merged_instruments.json
  const filePath = path.resolve(__dirname, 'merged_instruments.json');
  fs.writeFileSync(filePath, JSON.stringify(output, null, 2));
  
  console.log(`✓ Updated ${filePath} with ${filtered.length} current week NIFTY instruments`);
  console.log('Expiry breakdown:');
  const byExpiry: Record<string, number> = {};
  filtered.forEach((inst: any) => {
    const ex = inst.Expiry || inst.expiry || inst.ExpiryDate;
    let dt = ex ? DateTime.fromFormat(String(ex).trim(), 'dd-LLL-yyyy', { zone: 'Asia/Kolkata', locale: 'en' }) : null as any;
    if (!dt || !dt.isValid) dt = ex ? DateTime.fromISO(String(ex), { zone: 'Asia/Kolkata' }) : null as any;
    const key = dt && dt.isValid ? dt.toISODate()! : 'unknown';
    byExpiry[key] = (byExpiry[key] || 0) + 1;
  });
  Object.entries(byExpiry).forEach(([date, count]) => {
    console.log(`  ${date}: ${count} instruments`);
  });
}

if (require.main === module) {
  if (process.env.DISABLE_INSTRUMENTS_UPDATE === 'true') {
    console.warn('DISABLE_INSTRUMENTS_UPDATE=true; not performing weekly update.');
    // graceful no-op
  } else {
    updateWeeklyInstruments().catch(err => {
      console.error('Failed to update weekly instruments:', err);
      process.exit(1);
    });
  }
}
