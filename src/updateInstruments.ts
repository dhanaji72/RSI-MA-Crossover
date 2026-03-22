import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { promisify } from 'util';
import { pipeline } from 'stream';
import AdmZip from 'adm-zip';

const pipelineAsync = promisify(pipeline);

function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }

async function downloadFile(url: string, outputPath: string, attempts = 3): Promise<void> {
  let lastErr: any;
  for (let i = 1; i <= attempts; i++) {
    try {
      const response = await axios.get(url, {
        responseType: 'stream',
        timeout: 15000,
        headers: {
          'User-Agent': 'finvasia-bot/1.0',
          'Accept': '*/*'
        }
      });
      const writer = fs.createWriteStream(outputPath);
      await pipelineAsync(response.data, writer);
      return;
    } catch (err: any) {
      lastErr = err;
      const backoff = i === attempts ? 0 : Math.min(15000, 2000 * i * i);
      console.warn(`Download attempt ${i} failed (${err?.code || err?.message}).` + (backoff ? ` Retrying in ${Math.round(backoff/1000)}s...` : ''));
      if (backoff) await sleep(backoff);
    }
  }
  throw lastErr;
}

async function extractZip(zipPath: string, outputDir: string): Promise<string[]> {
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(outputDir, true);
  return zip.getEntries().map(entry => entry.entryName);
}

async function processTextFile(filePath: string): Promise<any[]> {
  const content = await fs.promises.readFile(filePath, 'utf8');
  const lines = content.split('\n').filter(line => line.trim() !== '');
  
  if (lines.length < 2) return []; // Need at least header + one row

  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split(',');
    const record: any = {};
    headers.forEach((header, index) => {
      record[header] = values[index]?.trim() || '';
    });
    return record;
  });
}

async function updateInstruments() {
  try {
    if (process.env.DISABLE_INSTRUMENTS_UPDATE === 'true') {
      console.warn('Instrument update disabled via DISABLE_INSTRUMENTS_UPDATE. Skipping download and file write.');
      const outputPath = path.join(__dirname, 'merged_instruments.json');
      if (fs.existsSync(outputPath)) {
        const cached = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
        return cached;
      }
      return { NFO: [] };
    }
    console.log('Updating NIFTY 50 weekly options only...');
    
    const urls = [
      'https://api.shoonya.com/NFO_symbols.txt.zip',
    ];

    const buildDir = path.join(__dirname, 'build');
    if (!fs.existsSync(buildDir)) {
      fs.mkdirSync(buildDir, { recursive: true });
    }

    // Download and process each file
    const allRecords: any[] = [];
    
    for (const url of urls) {
      const fileName = path.basename(url);
      const zipPath = path.join(buildDir, fileName);
      const tempDir = path.join(buildDir, 'temp');
      
      console.log(`Downloading ${fileName}...`);
      await downloadFile(url, zipPath, 3);
      
      console.log(`Extracting ${fileName}...`);
      const extractedFiles = await extractZip(zipPath, tempDir);
      
      // Process each extracted file
      for (const extractedFile of extractedFiles) {
        if (extractedFile.endsWith('.txt')) {
          const filePath = path.join(tempDir, extractedFile);
          console.log(`Processing ${extractedFile}...`);
          const records = await processTextFile(filePath);
          allRecords.push(...records);
          
          // Clean up extracted file
          fs.unlinkSync(filePath);
        }
      }
      
      // Clean up zip file and temp directory
      fs.unlinkSync(zipPath);
      fs.rmdirSync(tempDir);
    }

    console.log(`Downloaded ${allRecords.length} total NFO instruments`);

    // Filter for NIFTY 50 current weekly expiry only (next upcoming Tuesday)
    const { DateTime } = require('luxon');
    const todayIST = DateTime.now().setZone('Asia/Kolkata').startOf('day');
    
    // Find the next Tuesday expiry (start from tomorrow, i=1)
    let nearestTuesday: typeof DateTime | null = null;
    for (let i = 1; i <= 14; i++) {
      const checkDate = todayIST.plus({ days: i });
      if (checkDate.weekday === 2) { // Tuesday (luxon: 1=Monday, 2=Tuesday)
        nearestTuesday = checkDate;
        break;
      }
    }
    
    if (!nearestTuesday) {
      throw new Error('Could not find next Tuesday expiry within 14 days');
    }
    
    const nearestTuesdayISO = nearestTuesday.toISODate();
    console.log(`Filtering for current expiry only: ${nearestTuesdayISO}`);
    
    const nifty50Weekly = allRecords.filter(inst => {
      const sym = (inst.Symbol || '').toUpperCase();
      const tsym = (inst.TradingSymbol || '').toUpperCase();
      const instrument = (inst.Instrument || '').toUpperCase();
      
      // Must be OPTIDX (index options)
      if (instrument !== 'OPTIDX') return false;
      
      // Symbol must be exactly "NIFTY"
      if (sym !== 'NIFTY') return false;
      
      // TradingSymbol must start with NIFTY followed by a digit
      if (!tsym.startsWith('NIFTY') || !/^NIFTY\d/.test(tsym)) return false;
      
      // Exclude BANKNIFTY
      if (tsym.includes('BANK') || sym.includes('BANK')) return false;
      
      // Check expiry - only keep current week expiry (next upcoming Tuesday)
      const ex = inst.Expiry || inst.expiry || inst.ExpiryDate;
      if (!ex) return false;
      
      // Parse expiry date using luxon with IST timezone
      let expiryDate = DateTime.fromFormat(String(ex).trim(), 'dd-LLL-yyyy', { 
        zone: 'Asia/Kolkata', 
        locale: 'en' 
      });
      
      if (!expiryDate.isValid) {
        expiryDate = DateTime.fromISO(String(ex), { zone: 'Asia/Kolkata' });
      }
      
      if (!expiryDate.isValid) return false;
      
      // Must match the next Tuesday exactly
      return expiryDate.startOf('day').toISODate() === nearestTuesdayISO;
    });

    console.log(`Filtered to ${nifty50Weekly.length} NIFTY 50 current week expiry options`);

    // Get current NIFTY spot price estimate (use middle of strike range as proxy)
    const strikes = Array.from(new Set(nifty50Weekly.map((i: any) => parseFloat(i.StrikePrice)).filter(Boolean))).sort((a, b) => a - b);
    const atmStrike = strikes[Math.floor(strikes.length / 2)] || 24000; // fallback to 24000
    console.log(`Estimated ATM strike: ${atmStrike}`);

    // Keep only 20 strikes around ATM for each expiry (10 below, 10 above)
    const atmRange = 10;
    const atmIndex = strikes.findIndex(s => s >= atmStrike);
    const startIdx = Math.max(0, atmIndex - atmRange);
    const endIdx = Math.min(strikes.length, atmIndex + atmRange);
    const selectedStrikes = strikes.slice(startIdx, endIdx);
    console.log(`Selected ${selectedStrikes.length} strikes: ${selectedStrikes[0]} to ${selectedStrikes[selectedStrikes.length - 1]}`);

    // Filter to keep only instruments with selected strikes
    const filtered = nifty50Weekly.filter((inst: any) => {
      const strike = parseFloat(inst.StrikePrice);
      return selectedStrikes.includes(strike);
    });

    console.log(`Filtered to ${filtered.length} ATM-focused instruments (${selectedStrikes.length} strikes × 2 types × expiries)`);

    // Create grouped data structure
    const filteredGroupedData = { NFO: filtered };

    // Save to JSON
    const outputPath = path.join(__dirname, 'merged_instruments.json');
    await fs.promises.writeFile(outputPath, JSON.stringify(filteredGroupedData, null, 2));
    
    console.log(`Successfully updated ${outputPath} with ${filtered.length} NIFTY 50 current expiry ATM instruments`);
    return filteredGroupedData;
  } catch (error) {
    console.error('Error updating instruments:', error);
    // Fallback: try to use existing cached file if present
    try {
      const outputPath = path.join(__dirname, 'merged_instruments.json');
      if (fs.existsSync(outputPath)) {
        const cached = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
        const count = Array.isArray(cached?.NFO) ? cached.NFO.length : 0;
        if (count > 0) {
          console.warn(`Using cached instruments from ${outputPath} (${count} records)`);
          return cached;
        }
      }
    } catch {
      // ignore cache read errors and rethrow original
    }
    throw error;
  }
}

// Run the update only when executed directly, and not when disabled
if (require.main === module) {
  if (process.env.DISABLE_INSTRUMENTS_UPDATE === 'true') {
    console.warn('DISABLE_INSTRUMENTS_UPDATE=true; not performing update.');
    // Do not exit with error to keep CI/scripts happy
  } else {
    updateInstruments().catch(console.error);
  }
}

export { updateInstruments };