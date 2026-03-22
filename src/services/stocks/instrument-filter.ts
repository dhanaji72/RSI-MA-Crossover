import fs from 'fs';
import path from 'path';
import { DateTime } from 'luxon';

/**
 * Filter merged_instruments.json to keep only current expiry (nearest Tuesday)
 * This ensures we only trade current week expiry instruments
 */
export function filterCurrentExpiryOnly(): void {
  const filePath = path.resolve(__dirname, '../../merged_instruments.json');
  
  if (!fs.existsSync(filePath)) {
    console.warn('⚠️  merged_instruments.json not found, skipping expiry filter');
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    if (!data.NFO || !Array.isArray(data.NFO)) {
      console.warn('⚠️  Invalid merged_instruments.json format');
      return;
    }

    const originalCount = data.NFO.length;
    
    // Find the next Tuesday (current week expiry)
    // Start checking from tomorrow (i=1) to get the upcoming Tuesday, not today
    const todayIST = DateTime.now().setZone('Asia/Kolkata').startOf('day');
    let currentExpiry: DateTime | null = null;
    
    for (let i = 1; i <= 14; i++) {
      const checkDate = todayIST.plus({ days: i });
      if (checkDate.weekday === 2) { // Tuesday (1=Monday, 2=Tuesday, etc.)
        currentExpiry = checkDate;
        break;
      }
    }
    
    if (!currentExpiry) {
      console.warn('⚠️  Could not find nearest Tuesday expiry within 14 days');
      return;
    }
    
    const targetExpiry = currentExpiry.toISODate();
    console.log(`🔍 Filtering instruments for current expiry: ${targetExpiry}`);
    
    // Filter to keep only current expiry instruments
    const filtered = data.NFO.filter((inst: any) => {
      const ex = inst.Expiry || inst.expiry || inst.ExpiryDate;
      if (!ex) return false;
      
      // Parse the expiry date
      let dt = DateTime.fromFormat(String(ex).trim(), 'dd-LLL-yyyy', { 
        zone: 'Asia/Kolkata', 
        locale: 'en' 
      });
      
      if (!dt.isValid) {
        dt = DateTime.fromISO(String(ex), { zone: 'Asia/Kolkata' });
      }
      
      if (!dt.isValid) return false;
      
      const expiryDate = dt.startOf('day').toISODate();
      return expiryDate === targetExpiry;
    });
    
    if (filtered.length === 0) {
      console.warn(`⚠️  No instruments found for expiry ${targetExpiry}, keeping original file`);
      return;
    }
    
    // Update the file with filtered data
    data.NFO = filtered;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    
    const removedCount = originalCount - filtered.length;
    console.log(`✅ Filtered instruments: ${originalCount} → ${filtered.length} (removed ${removedCount} next expiry instruments)`);
    console.log(`✅ Current expiry: ${targetExpiry}`);
    
  } catch (error) {
    console.error('❌ Error filtering instruments:', error);
  }
}
