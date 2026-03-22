const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');

// Read the current merged_instruments.json
const filePath = path.resolve(__dirname, 'src/merged_instruments.json');
console.log('Reading:', filePath);
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

const allInstruments = data.NFO || [];
console.log(`Total instruments in file: ${allInstruments.length}`);

// Strict NIFTY 50 filter
const nifty50Only = allInstruments.filter(inst => {
  const sym = (inst.Symbol || '').toUpperCase();
  const tsym = (inst.TradingSymbol || '').toUpperCase();
  const instrument = (inst.Instrument || '').toUpperCase();
  
  // Must be OPTIDX (index options)
  if (instrument !== 'OPTIDX') return false;
  
  // Symbol must be exactly "NIFTY"
  if (sym !== 'NIFTY') return false;
  
  // TradingSymbol must start with NIFTY followed by a digit (excludes BANKNIFTY)
  if (!tsym.startsWith('NIFTY') || !/^NIFTY\d/.test(tsym)) return false;
  
  // Exclude anything with BANK
  if (tsym.includes('BANK') || sym.includes('BANK')) return false;
  
  // Check expiry - only keep weekly (next 2 Tuesdays within 14 days)
  const ex = inst.Expiry || inst.expiry || inst.ExpiryDate;
  if (!ex) return false;
  
  let dt = DateTime.fromFormat(String(ex).trim(), 'dd-LLL-yyyy', { zone: 'Asia/Kolkata', locale: 'en' });
  if (!dt.isValid) dt = DateTime.fromISO(String(ex), { zone: 'Asia/Kolkata' });
  if (!dt.isValid) return false;

  // Must be Tuesday in IST
  if (dt.weekday !== 2) return false;

  // Must be within 14 days from today in IST
  const today = DateTime.now().setZone('Asia/Kolkata').startOf('day');
  const diffDays = dt.startOf('day').diff(today, 'days').days;
  
  return diffDays > 0 && diffDays <= 14;
});

console.log(`Filtered to ${nifty50Only.length} NIFTY 50 weekly options`);

// Expiry breakdown
const byExpiry = {};
nifty50Only.forEach(inst => {
  const ex = inst.Expiry || inst.expiry || inst.ExpiryDate;
  const key = ex ? new Date(ex).toISOString().split('T')[0] : 'unknown';
  byExpiry[key] = (byExpiry[key] || 0) + 1;
});

console.log('Expiry breakdown:');
Object.entries(byExpiry).forEach(([date, count]) => {
  console.log(`  ${date}: ${count} instruments`);
});

// Write back
const output = { NFO: nifty50Only };
fs.writeFileSync(filePath, JSON.stringify(output, null, 2));
console.log(`✓ Updated ${filePath} with ${nifty50Only.length} instruments`);
