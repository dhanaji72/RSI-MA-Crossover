import { getStockList } from './services/stocks/stocklist';

async function run() {
  console.log('Fetching NIFTY CE with exact expiry 16-DEC-2025');
  const ce = await getStockList({
    query: 'NIFTY',
    exchange: 'NFO',
    optionType: 'CE',
    exactExpiry: '16-DEC-2025',
    limit: 500
  });
  console.log('CE stat:', ce.stat, 'count:', ce.values?.length || 0, ce.emsg || '');

  console.log('Fetching NIFTY PE with exact expiry 16-DEC-2025');
  const pe = await getStockList({
    query: 'NIFTY',
    exchange: 'NFO',
    optionType: 'PE',
    exactExpiry: '16-DEC-2025',
    limit: 500
  });
  console.log('PE stat:', pe.stat, 'count:', pe.values?.length || 0, pe.emsg || '');
}

run().catch(console.error);
