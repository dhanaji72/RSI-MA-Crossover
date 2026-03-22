// Simple Node.js script to fetch real-time NIFTY 50 index price from Yahoo Finance
const https = require('https');

const url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?interval=1m&range=1d';

https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      const result = json.chart.result[0];
      const lastClose = result.indicators.quote[0].close.pop();
      const lastTimestamp = result.timestamp.pop();
      const lastDate = new Date(lastTimestamp * 1000);
      console.log(`NIFTY 50 Spot: ${lastClose} @ ${lastDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    } catch (e) {
      console.error('Failed to parse Yahoo response:', e);
    }
  });
}).on('error', (e) => {
  console.error('Error fetching NIFTY 50 price:', e);
});
