import { getStockList } from './services/stocks/stocklist';

async function testFetch() {
  console.log('Fetching NIFTY CE options from Shoonya API (no weeklyOnly filter)...');
  
  const response = await getStockList({
    query: 'NIFTY',
    exchange: 'NFO',
    optionType: 'CE',
    limit: 500
  });
  
  if (response.stat === 'Ok' && response.values) {
    console.log(`\nTotal instruments: ${response.values.length}`);
    
    // Group by expiry date
    const expiryMap = new Map<string, number>();
    response.values.forEach((inst: any) => {
      const expiry = inst.Expiry || inst.expiry || inst.ExpiryDate;
      if (expiry) {
        const d = new Date(expiry);
        const dateStr = d.toISOString().split('T')[0];
        const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
        const key = `${dateStr} (${dayName})`;
        expiryMap.set(key, (expiryMap.get(key) || 0) + 1);
      }
    });
    
    console.log('\nExpiry breakdown:');
    Array.from(expiryMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([expiry, count]) => {
        console.log(`  ${expiry}: ${count} instruments`);
      });
    
    // Show sample instruments for Dec 16 and Dec 23
    const dec16Instruments = response.values.filter((inst: any) => {
      const expiry = inst.Expiry || inst.expiry || inst.ExpiryDate;
      if (!expiry) return false;
      const d = new Date(expiry);
      return d.getDate() === 16 && d.getMonth() === 11 && d.getFullYear() === 2025;
    });
    
    const dec23Instruments = response.values.filter((inst: any) => {
      const expiry = inst.Expiry || inst.expiry || inst.ExpiryDate;
      if (!expiry) return false;
      const d = new Date(expiry);
      return d.getDate() === 23 && d.getMonth() === 11 && d.getFullYear() === 2025;
    });
    
    console.log(`\nDec 16 instruments: ${dec16Instruments.length}`);
    if (dec16Instruments.length > 0) {
      console.log('Sample:', dec16Instruments[0]);
    }
    
    console.log(`\nDec 23 instruments: ${dec23Instruments.length}`);
    if (dec23Instruments.length > 0) {
      console.log('Sample:', dec23Instruments[0]);
    }
  } else {
    console.log('Error:', response.emsg || 'Unknown error');
  }
}

testFetch().catch(console.error);
