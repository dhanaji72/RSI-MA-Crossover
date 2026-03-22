import { MORNING_STRATEGY_CONFIG } from './config/morning-strategy-config';
import { initializeStrategy } from './lib/strategy-initializer';
import { runMorningTradingLoop } from './lib/morning-trading-loop';
import { DateTime } from 'luxon';
import 'dotenv/config';

// ==================== MORNING STRATEGY (Single Session) ====================
// Session: 9:25 AM - 2:50 PM with forced exit at 3:05 PM if target/stop not hit
// 
// Uses 5-minute candles with dual RSI signal conditions:
// - Bullish Condition 1 (All Sessions): RSI crosses above RSI-EMA with +3pt increase
// - Bullish Condition 2 (Session 1 ONLY): RSI crosses above 65 with +3pt increase
// - Bearish Condition 1 (All Sessions): RSI crosses below RSI-EMA with -3pt decrease AND RSI<60 above 50 OR RSI<35 below 50
// - Bearish Condition 2 (Session 1 ONLY): RSI crosses below 40 with -3pt decrease
// - All signals require: |RSI - RSI_EMA| > 2 for validation
// - ADX Filter: ADX > 18 required for entry (trend strength)
// - Momentum Check: Position must hit +10% profit within 30 minutes (6 candles) or auto-exit
// 
// Risk Management: Target +50%, Initial Stop -20%, Trailing Stop -15%
// ============================================================================

// When used as a standalone script, we want to exit the process at the end.
// When used from index.ts, we only want to start/stop the strategy loop and
// keep the main process (MCP server) alive. This flag controls that behavior.
async function runMorningStrategy(allowProcessExit: boolean = require.main === module) {
  try {
    const now = DateTime.now().setZone('Asia/Kolkata');
    const currentTime = now.hour * 60 + now.minute;
    
    // Morning window: 9:15 AM to 2:50 PM
    const morningStartTime = MORNING_STRATEGY_CONFIG.START_HOUR * 60 + MORNING_STRATEGY_CONFIG.START_MINUTE;
    const morningEndTime = MORNING_STRATEGY_CONFIG.END_HOUR * 60 + MORNING_STRATEGY_CONFIG.END_MINUTE;
    
    // ===== CHECK IF WE'RE IN THE MORNING WINDOW =====
    if (currentTime >= morningEndTime) {
      console.log('\n' + '='.repeat(80));
      console.log('⚠️  STRATEGY WINDOW ALREADY PASSED (After 2:50 PM)');
      console.log('⚠️  This strategy only runs between 9:15 AM - 2:50 PM');
      console.log('⚠️  Market trading has ended for the day');
      console.log('='.repeat(80) + '\n');

      if (allowProcessExit) {
        process.exit(0);
      }
      return;
    }
    
    // ===== WAIT IF STARTED BEFORE 9:15 AM =====
    if (currentTime < morningStartTime) {
      const waitMinutes = morningStartTime - currentTime;
      console.log('\n' + '='.repeat(80));
      console.log(`⏰ MORNING STRATEGY - Waiting for market opening`);
      console.log(`⏰ Current time: ${now.toFormat('HH:mm:ss')}`);
      console.log(`⏰ Waiting ${waitMinutes} minutes until 9:15 AM...`);
      console.log('='.repeat(80) + '\n');
      
      // Wait until morning strategy time
      await new Promise(resolve => setTimeout(resolve, waitMinutes * 60 * 1000));
      
      console.log(`✅ Morning strategy time reached: ${DateTime.now().setZone('Asia/Kolkata').toFormat('HH:mm:ss')}\n`);
    }
    
    // ===== START MORNING STRATEGY =====
    console.log('\n' + '='.repeat(80));
    console.log('🌅 SINGLE-SESSION TRADING STRATEGY STARTED');
    console.log('📊 Session: 9:25 AM - 2:50 PM (Exit at 3:05 PM if target/stop not hit)');
    console.log('📊 Using 5-minute candles starting from 9:15 AM');
    console.log('📊 Signal conditions (EITHER condition triggers signal):');
    console.log('   • Bullish Condition 1 (All Sessions): RSI crosses above RSI-EMA with +3pt increase');
    console.log('   • Bullish Condition 2 (Session 1 ONLY): RSI crosses above 65 with +3pt increase');
    console.log('   • Bearish Condition 1 (All Sessions): RSI crosses below RSI-EMA with -3pt decrease (+ RSI level checks)');
    console.log('   • Bearish Condition 2 (Session 1 ONLY): RSI crosses below 40 with -3pt decrease');
    console.log('   • All signals require: |RSI - RSI_EMA| > 2');
    console.log('   • ADX Filter: ADX > 18 (trend strength required)');
    console.log('   • Momentum Check: Position must hit +10% within 15 minutes or auto-exit');
    console.log('📊 Risk Management: Target +50% | Initial Stop -20% | Trailing Stop -15%');
    console.log('='.repeat(80) + '\n');
    
    // Initialize strategy (check existing positions, fetch historical data, etc.)
    const existingPosition = await initializeStrategy(MORNING_STRATEGY_CONFIG);
    
    // Run morning trading loop
    // This will automatically end at 2:55 PM and return any open position
    const morningPosition = await runMorningTradingLoop(MORNING_STRATEGY_CONFIG, existingPosition);
    
    // ===== MORNING STRATEGY ENDED =====
    console.log('\n' + '='.repeat(80));
    console.log('⏰ MORNING STRATEGY ENDED (12:30 PM reached)');
    
    if (morningPosition) {
      console.log('📌 Open position detected:');
      console.log(`   Symbol: ${morningPosition.instrument?.TradingSymbol || 'Unknown'}`);
      console.log(`   Type: ${morningPosition.type.toUpperCase()}`);
      console.log('⚠️  Position will continue to be monitored with existing stop loss');
    } else {
      console.log('✅ No open positions');
    }
    
    console.log('='.repeat(80) + '\n');

    // Exit after morning strategy completes (only when run as standalone)
    if (allowProcessExit) {
      process.exit(0);
    }
    return;
    
  } catch (err) {
    console.error('❌ Fatal error in morning strategy:', err);
    if (allowProcessExit) {
      process.exit(1);
    }
    throw err;
  }
}

// ==================== Entry Point ====================
if (require.main === module) {
  runMorningStrategy(true).catch(err => {
    console.error('❌ Unhandled error:', err);
    process.exit(1);
  });
}

export default runMorningStrategy;
export { runMorningStrategy as startMorningStrategy };
