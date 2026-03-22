import { MORNING_STRATEGY_CONFIG } from './config/morning-strategy-config';
import { initializeStrategy } from './lib/strategy-initializer';
import { runMorningTradingLoop } from './lib/morning-trading-loop';
import { DateTime } from 'luxon';
import 'dotenv/config';

// ==================== MORNING STRATEGY (9:15 AM - 2:55 PM) ====================
// This strategy runs during market hours
// Uses 5-minute candles with custom RSI signal conditions:
// - Bullish: RSI crosses above RSI-EMA (AND RSI > 30) OR RSI crosses above 70
// - Bearish: RSI crosses below RSI-EMA (AND RSI < 70) OR RSI crosses below 30
// Risk Management: Target +200%, Initial Stop -15%, Trailing Stop -10%
// 
// The strategy cleans up all positions and orders at 2:55 PM
// Automatically restarts next trading day at 9:10 AM (Monday-Friday)
// ============================================================================

async function waitUntilNextTradingDay() {
  const now = DateTime.now().setZone('Asia/Kolkata');
  const currentDay = now.weekday; // 1 = Monday, 7 = Sunday
  
  // Check if it's a weekend
  if (currentDay === 6) {
    // Saturday - wait until Monday 9:10 AM
    const nextMonday = now.plus({ days: 2 }).set({ hour: 9, minute: 10, second: 0, millisecond: 0 });
    const waitMs = nextMonday.toMillis() - now.toMillis();
    console.log(`📅 Weekend detected - Waiting until Monday ${nextMonday.toFormat('MMM dd')} at 9:10 AM`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  } else if (currentDay === 7) {
    // Sunday - wait until Monday 9:10 AM
    const nextMonday = now.plus({ days: 1 }).set({ hour: 9, minute: 10, second: 0, millisecond: 0 });
    const waitMs = nextMonday.toMillis() - now.toMillis();
    console.log(`📅 Weekend detected - Waiting until Monday ${nextMonday.toFormat('MMM dd')} at 9:10 AM`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  } else if (currentDay === 5 && now.hour >= 10) {
    // Friday after 10 AM - wait until Monday 9:10 AM
    const nextMonday = now.plus({ days: 3 }).set({ hour: 9, minute: 10, second: 0, millisecond: 0 });
    const waitMs = nextMonday.toMillis() - now.toMillis();
    console.log(`📅 Friday completed - Waiting until Monday ${nextMonday.toFormat('MMM dd')} at 9:10 AM`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  } else {
    // Weekday - wait until next day 9:10 AM
    const nextDay = now.plus({ days: 1 }).set({ hour: 9, minute: 10, second: 0, millisecond: 0 });
    const waitMs = nextDay.toMillis() - now.toMillis();
    console.log(`⏰ Waiting until ${nextDay.toFormat('EEE, MMM dd')} at 9:10 AM`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
}

async function main() {
  while (true) {
    try {
      let now = DateTime.now().setZone('Asia/Kolkata');
      const currentDay = now.weekday; // 1 = Monday, 7 = Sunday
      
      // Skip weekends
      if (currentDay === 6 || currentDay === 7) {
        console.log('\n' + '='.repeat(80));
        console.log('📅 Weekend detected - Market closed');
        console.log('='.repeat(80) + '\n');
        await waitUntilNextTradingDay();
        continue;
      }
      
      let currentTime = now.hour * 60 + now.minute;
      
      // Morning window: 9:15 AM to 2:50 PM
      const morningStartTime = MORNING_STRATEGY_CONFIG.START_HOUR * 60 + MORNING_STRATEGY_CONFIG.START_MINUTE;
      const morningEndTime = MORNING_STRATEGY_CONFIG.END_HOUR * 60 + MORNING_STRATEGY_CONFIG.END_MINUTE;
      
      // Check if we're past the morning window for today
      if (currentTime >= morningEndTime) {
        console.log('\n' + '='.repeat(80));
        console.log('⚠️  STRATEGY WINDOW ALREADY PASSED (After 2:50 PM)');
        console.log('⚠️  Current time: ' + now.toFormat('HH:mm:ss'));
        console.log('⏰ Waiting for next trading day at 9:10 AM...');
        console.log('='.repeat(80) + '\n');
        await waitUntilNextTradingDay();
        continue;
      }
      
      // If started before morning strategy time, wait until 9:15 AM
      if (currentTime < morningStartTime) {
        const waitMinutes = morningStartTime - currentTime;
        console.log('\n' + '='.repeat(80));
        console.log(`⏰ Started before morning strategy window`);
        console.log(`⏰ Current time: ${now.toFormat('HH:mm:ss')}`);
        console.log(`⏰ Waiting ${waitMinutes} minutes until 9:15 AM...`);
        console.log('='.repeat(80) + '\n');
        
        // Wait until morning strategy time
        await new Promise(resolve => setTimeout(resolve, waitMinutes * 60 * 1000));
        
        // Update current time after waiting
        now = DateTime.now().setZone('Asia/Kolkata');
        currentTime = now.hour * 60 + now.minute;
        
        console.log(`✅ Morning strategy time reached: ${now.toFormat('HH:mm:ss')}\n`);
      }
      
      // =========================
      // MORNING STRATEGY (9:15 AM - 2:50 PM)
      // =========================
      console.log('\n' + '='.repeat(80));
      console.log(`🌅 MORNING STRATEGY STARTED - ${now.toFormat('EEE, MMM dd, yyyy')}`);
      console.log('⏰ Time: 9:15 AM - 2:50 PM');
      console.log('📊 Using 5-minute candles with custom RSI signal conditions');
      console.log('📊 Risk: Target +200% | Initial Stop -15% | Trailing Stop -10%');
      console.log('='.repeat(80) + '\n');
      
      // Initialize with morning strategy config
      const existingPosition = await initializeStrategy(MORNING_STRATEGY_CONFIG);
      
      // Run morning strategy - positions monitored until session exit / cleanup time
      await runMorningTradingLoop(MORNING_STRATEGY_CONFIG, existingPosition);
      
      console.log('\n' + '='.repeat(80));
      console.log('✅ MORNING STRATEGY COMPLETED');
      console.log('✅ Positions and orders will be cleaned up by configured exit/cleanup time');
      console.log('🔄 Preparing for next trading day...');
      console.log('='.repeat(80) + '\n');
      
      // Wait for next trading day
      await waitUntilNextTradingDay();
      
    } catch (err) {
      console.error('❌ Error in strategy:', err);
      console.log('⏰ Waiting 5 minutes before retry...');
      await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
    }
  }
}

// ==================== Entry Point ====================
if (require.main === module) {
  main().catch(err => {
    console.error('❌ Unhandled error:', err);
    process.exit(1);
  });
}

export default main;
export { main as startMorningStrategy };
