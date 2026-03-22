const fs = require('fs');
const data = JSON.parse(fs.readFileSync('src/merged_instruments.json', 'utf8'));
const byExp = {};
data.NFO.forEach(i => {
  byExp[i.Expiry] = (byExp[i.Expiry] || 0) + 1;
});
console.log('Expiry breakdown:');
Object.entries(byExp).forEach(([k, v]) => console.log(`  ${k}: ${v} instruments`));
console.log(`Total: ${data.NFO.length}`);
