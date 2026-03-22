import { setTimeout as sleep } from 'timers/promises';
import { handleBullishSignal } from '../scenarios/bullish';
import { handleBearishSignal } from '../scenarios/bearish';
import { ExistingPositionInfo } from './order-handler';
import { calculateCurrentIndicators, printIndicatorValues } from './indicator-monitor';
import { getHybridCandles } from '../../services/stocks/instrument-updater';
import { MorningStrategyConfig } from '../config/morning-strategy-config';
import { getPositions, getOrderBook, cancelOrder, placeOrder } from '../../services/orders/order';
import { monitorAndSquareOffLosses } from './position-monitor';
import { calculateRSI, calculateEMA } from './indicators';
import { DateTime } from 'luxon';

interface ActivePosition {
  type: 'bullish' | 'bearish';
  details: any;
  instrument: any;
  entrySignalType?: 'rsi-level-crossover' | 'rsi-ema-crossover' | 'rsi-threshold';
  session?: number;
  entryTime?: DateTime;
}

/**
 * Detect bullish signal
 * Condition 1: RSI crosses above RSI-EMA with RSI increase of at least 3 points (All sessions)
 * Condition 2: RSI crosses above threshold (65) with RSI increase of at least 3 points (Session 1 ONLY)
 */
function isRsiEmaBullishCrossover(
  currentRsi: number,
  currentRsiEma: number,
  prevRsi: number,
  prevRsiEma: number,
  minRsiEmaDiff: number = 3,
  rsiOverboughtThreshold: number = 65,
  allowThresholdSignal: boolean = true
): boolean {
  // Check for valid values
  if (Number.isNaN(currentRsi) || Number.isNaN(currentRsiEma) || Number.isNaN(prevRsi) || Number.isNaN(prevRsiEma)) {
    return false;
  }
  
  // Condition 1: RSI-EMA Crossover with RSI movement check
  const crossoverAbove = prevRsi <= prevRsiEma && currentRsi > currentRsiEma;
  const rsiEmaDiff = Math.abs(currentRsi - currentRsiEma);
  const rsiIncrease = currentRsi - prevRsi; // RSI increase
  const hasRsiEmaCrossover = crossoverAbove && rsiEmaDiff > minRsiEmaDiff && rsiIncrease >= 3;
  
  // Condition 2: RSI Threshold Crossover (crosses above overbought level) with RSI movement check
  // Only allowed in Session 1 (controlled by allowThresholdSignal parameter)
  const rsiThresholdCrossover = prevRsi <= rsiOverboughtThreshold && currentRsi > rsiOverboughtThreshold;
  const hasRsiThresholdCrossover = allowThresholdSignal && rsiThresholdCrossover && Math.abs(currentRsi - currentRsiEma) > minRsiEmaDiff && rsiIncrease >= 3;
  
  // Return true if EITHER condition is met
  return hasRsiEmaCrossover || hasRsiThresholdCrossover;
}

/**
 * Detect bearish signal
 * Condition 1: RSI crosses below RSI-EMA with RSI decrease of at least 3 points (All sessions)
 *              AND RSI < 60 when above 50 OR RSI < 35 when below 50
 * Condition 2: RSI crosses below threshold (40) with RSI decrease of at least 3 points (Session 1 ONLY)
 */
function isRsiEmaBearishCrossover(
  currentRsi: number,
  currentRsiEma: number,
  prevRsi: number,
  prevRsiEma: number,
  minRsiEmaDiff: number = 3,
  rsiOversoldThreshold: number = 40,
  allowThresholdSignal: boolean = true
): boolean {
  // Check for valid values
  if (Number.isNaN(currentRsi) || Number.isNaN(currentRsiEma) || Number.isNaN(prevRsi) || Number.isNaN(prevRsiEma)) {
    return false;
  }
  
  // Condition 1: RSI-EMA Crossover with RSI movement check and RSI level conditions
  const crossoverBelow = prevRsi >= prevRsiEma && currentRsi < currentRsiEma;
  const rsiEmaDiff = Math.abs(currentRsi - currentRsiEma);
  const rsiDecrease = prevRsi - currentRsi; // RSI decrease
  
  // RSI level condition: RSI < 60 when above 50 OR RSI < 35 when below 50
  let rsiLevelCondition = false;
  if (currentRsi > 50) {
    rsiLevelCondition = currentRsi < 60;
  } else {
    rsiLevelCondition = currentRsi < 35;
  }
  
  const hasRsiEmaCrossover = crossoverBelow && rsiEmaDiff > minRsiEmaDiff && rsiDecrease >= 3 && rsiLevelCondition;
  
  // Condition 2: RSI Threshold Crossover (crosses below oversold level) with RSI movement check
  // Only allowed in Session 1 (controlled by allowThresholdSignal parameter)
  const rsiThresholdCrossover = prevRsi >= rsiOversoldThreshold && currentRsi < rsiOversoldThreshold;
  const hasRsiThresholdCrossover = allowThresholdSignal && rsiThresholdCrossover && Math.abs(currentRsi - currentRsiEma) > minRsiEmaDiff && rsiDecrease >= 3;
  
  // Return true if EITHER condition is met
  return hasRsiEmaCrossover || hasRsiThresholdCrossover;
}

/**
 * Handle morning bullish signal
 */
async function handleMorningBullishSignal(
  config: MorningStrategyConfig,
  activePosition: ActivePosition | null,
  entrySignalType: 'rsi-level-crossover' | 'rsi-ema-crossover' | 'rsi-threshold' = 'rsi-ema-crossover'
): Promise<ActivePosition | null> {
  console.log('🔄 Fetching fresh positions and orders from Shoonya API...');
  const positionsResponse: any = await getPositions();
  const orderBookResponse: any = await getOrderBook();
  
  let hasCEPosition = false;
  let hasPEPosition = false;
  
  if (positionsResponse && Array.isArray(positionsResponse)) {
    const openPositions = positionsResponse.filter((pos: any) => {
      const netQty = parseInt(pos.netqty || '0');
      return netQty !== 0 && pos.prd === 'M';
    });
    
    for (const pos of openPositions) {
      if (pos.tsym && pos.tsym.includes('CE')) {
        hasCEPosition = true;
        console.log(`   Found existing CE position: ${pos.tsym}`);
      }
      if (pos.tsym && pos.tsym.includes('PE')) {
        hasPEPosition = true;
        console.log(`   Found existing PE position: ${pos.tsym}`);
      }
    }
  }
  
  if (hasCEPosition) {
    console.log('⏸️  Existing BULLISH (CE) position found - Skipping fresh BULLISH signal');
    console.log('   Waiting for CE position to hit target/stop loss before new entry\n');
    return activePosition;
  }
  
  if (hasPEPosition) {
    console.log('⏸️  Existing BEARISH (PE) position found - Skipping BULLISH signal');
    console.log('   Waiting for PE position to hit target/stop loss before new entry\n');
    return activePosition;
  }
  
  try {
    console.log('🔍 Searching for CE option near premium ₹' + config.TARGET_PREMIUM + '...');
    const result = await handleBullishSignal({
      targetPremium: config.TARGET_PREMIUM,
      targetPercent: config.TARGET_PERCENT,
      stopPercent: config.STOP_PERCENT
    });
    
    if (result) {
      console.log('✅ MORNING BULLISH POSITION ENTERED:');
      console.log(`   Instrument: ${result.instrument?.TradingSymbol || 'Unknown'}`);
      console.log(`   Target: +${config.TARGET_PERCENT}% | Stop: -${config.STOP_PERCENT}%`);
      console.log(`   Entry Signal: ${entrySignalType}`);
      return {
        type: 'bullish',
        details: result,
        instrument: result.instrument,
        entrySignalType
      };
    }
  } catch (err) {
    console.error('❌ Error:', err);
  }
  
  return activePosition;
}

/**
 * Handle morning bearish signal
 */
async function handleMorningBearishSignal(
  config: MorningStrategyConfig,
  activePosition: ActivePosition | null,
  entrySignalType: 'rsi-level-crossover' | 'rsi-ema-crossover' | 'rsi-threshold' = 'rsi-ema-crossover'
): Promise<ActivePosition | null> {
  console.log('🔄 Fetching fresh positions and orders from Shoonya API...');
  const positionsResponse: any = await getPositions();
  const orderBookResponse: any = await getOrderBook();
  
  let hasCEPosition = false;
  let hasPEPosition = false;
  
  if (positionsResponse && Array.isArray(positionsResponse)) {
    const openPositions = positionsResponse.filter((pos: any) => {
      const netQty = parseInt(pos.netqty || '0');
      return netQty !== 0 && pos.prd === 'M';
    });
    
    for (const pos of openPositions) {
      if (pos.tsym && pos.tsym.includes('CE')) {
        hasCEPosition = true;
        console.log(`   Found existing CE position: ${pos.tsym}`);
      }
      if (pos.tsym && pos.tsym.includes('PE')) {
        hasPEPosition = true;
        console.log(`   Found existing PE position: ${pos.tsym}`);
      }
    }
  }
  
  if (hasPEPosition) {
    console.log('⏸️  Existing BEARISH (PE) position found - Skipping fresh BEARISH signal');
    console.log('   Waiting for PE position to hit target/stop loss before new entry\n');
    return activePosition;
  }
  
  if (hasCEPosition) {
    console.log('⏸️  Existing BULLISH (CE) position found - Skipping BEARISH signal');
    console.log('   Waiting for CE position to hit target/stop loss before new entry\n');
    return activePosition;
  }
  
  try {
    console.log('🔍 Searching for PE option near premium ₹' + config.TARGET_PREMIUM + '...');
    const result = await handleBearishSignal({
      targetPremium: config.TARGET_PREMIUM,
      targetPercent: config.TARGET_PERCENT,
      stopPercent: config.STOP_PERCENT
    });
    
    if (result) {
      console.log('✅ MORNING BEARISH POSITION ENTERED:');
      console.log(`   Instrument: ${result.instrument?.TradingSymbol || 'Unknown'}`);
      console.log(`   Target: +${config.TARGET_PERCENT}%`);
      console.log(`   Stop Loss: -${config.STOP_PERCENT}%`);
      console.log(`   Entry Signal: ${entrySignalType}`);
      return {
        type: 'bearish',
        details: result,
        instrument: result.instrument,
        entrySignalType
      };
    }
  } catch (err) {
    console.error('❌ Error handling morning bearish signal:', err);
  }
  
  return activePosition;
}

/**
 * Check if current time is within the configured trading session window
 */
function isWithinTradingSession(config: MorningStrategyConfig): boolean {
  const now = new Date();
  const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const currentHour = istTime.getHours();
  const currentMinute = istTime.getMinutes();
  
  const startTime = config.SESSION_START_HOUR * 60 + config.SESSION_START_MINUTE;
  const endTime = config.SESSION_END_HOUR * 60 + config.SESSION_END_MINUTE;
  const currentTime = currentHour * 60 + currentMinute;
  
  return currentTime >= startTime && currentTime < endTime;
}

/**
 * Morning trading loop (9:15 AM - 9:45 AM) with 3-minute candles
 * Orders are placed/cancelled ONLY on candle completion, not during candle formation
 */
export async function runMorningTradingLoop(config: MorningStrategyConfig, existingPosition: ExistingPositionInfo | null = null): Promise<ActivePosition | null> {
  let activePosition: ActivePosition | null = existingPosition ? {
    type: existingPosition.type,
    details: existingPosition.details,
    instrument: existingPosition.instrument
  } : null;
  let lastCandleCount = getHybridCandles().length;
  
  // Store previous candle's RSI and EMA values
  let prevRsi: number | null = null;
  let prevRsiEma: number | null = null;
  
  console.log('\n🌅 MORNING STRATEGY STARTED');
  console.log(`📊 Candle formation: ${config.INTERVAL_MINUTES}-minute candles from 9:15 AM`);
  console.log(`📊 New positions: ${config.SESSION_START_HOUR}:${config.SESSION_START_MINUTE.toString().padStart(2, '0')} - ${config.SESSION_END_HOUR}:${config.SESSION_END_MINUTE.toString().padStart(2, '0')}`);
  console.log(`📊 Position monitoring: Until target/SL or ${config.SESSION_EXIT_HOUR}:${config.SESSION_EXIT_MINUTE.toString().padStart(2, '0')}`);
  console.log(`📌 Bullish Condition 1: RSI crosses above RSI-EMA AND RSI > 40`);
  console.log(`📌 Bullish Condition 2: RSI crosses above ${config.RSI_OVERBOUGHT}`);
  console.log(`📌 Bearish Condition 1: RSI crosses below RSI-EMA AND RSI < 60 (or < 35 if RSI ≤ 50)`);
  console.log(`📌 Bearish Condition 2: RSI crosses below ${config.RSI_OVERSOLD}`);
  console.log(`✅ All signals require: |RSI - RSI_EMA| > ${config.MIN_RSI_EMA_DIFF}`);

  console.log(`💰 Risk: Target +${config.TARGET_PERCENT}% | Initial Stop -${config.STOP_PERCENT}% | Trailing Stop -${config.TRAILING_STOP_PERCENT}%`);
  console.log(`🔒 Profit Lock: When price hits +${config.MIN_PROFIT_LOCK_PERCENT}% of entry, stop is raised to entry +${config.LOCKED_PROFIT_PERCENT}% and trailing stop activates\n`);
  
  while (true) {
    await sleep(config.LOOP_INTERVAL_MS);
    
    // Monitor active position for target/stop loss every 2 seconds
    // If hit, position is squared off and activePosition becomes null,
    // allowing new signals to be taken
    if (activePosition) {
      activePosition = await monitorAndSquareOffLosses(
        activePosition,
        config.STOP_PERCENT,
        config.TARGET_PERCENT,
        config.TRAILING_STOP_PERCENT,
        config.MIN_PROFIT_LOCK_PERCENT,
        config.LOCKED_PROFIT_PERCENT,
      );
      
      // If position was squared off (target or stop loss hit), show confirmation
      if (!activePosition) {
        console.log('✅ Position squared off - Ready for new signals\n');
      }
    }
    
    const currentCandleCount = getHybridCandles().length;
    const newCandleCompleted = currentCandleCount > lastCandleCount;
    
    const indicators = calculateCurrentIndicators(config);
    
    if (!indicators) {
      continue;
    }
    
    // ⚠️ CRITICAL: All order placing/cancellation operations happen ONLY when candle completes
    // This ensures we don't act on incomplete candle data during formation
    if (newCandleCompleted) {
      console.log(`\nNew ${config.INTERVAL_MINUTES}-minute candle completed`);
      
      // Get current RSI and EMA values
      const currentRsi = indicators.rsi;
      const currentRsiEma = indicators.rsiEma;
      
      printIndicatorValues(config, indicators, prevRsi, prevRsiEma);
      lastCandleCount = currentCandleCount;
      
      // Check for signals only if we have previous values stored
      if (prevRsi !== null && prevRsiEma !== null) {
        // Check if within trading session
        const inTradingSession = isWithinTradingSession(config);
        const currentSession = inTradingSession ? 1 : 0;
        
        // Allow RSI threshold crossover signals only during the active trading session
        const allowThresholdSignals = inTradingSession;
        
        // Detect RSI-EMA crossovers and RSI threshold crossovers
        const rsiEmaBullishSignal = isRsiEmaBullishCrossover(
          currentRsi,
          currentRsiEma,
          prevRsi,
          prevRsiEma,
          config.MIN_RSI_EMA_DIFF,
          config.RSI_OVERBOUGHT,
          allowThresholdSignals
        );
        const rsiEmaBearishSignal = isRsiEmaBearishCrossover(
          currentRsi,
          currentRsiEma,
          prevRsi,
          prevRsiEma,
          config.MIN_RSI_EMA_DIFF,
          config.RSI_OVERSOLD,
          allowThresholdSignals
        );
        
        // If we have an active position, only monitor for target/stop loss
        // Opposite signals are IGNORED - positions exit only on target or stop loss
        if (activePosition) {
          // Position is active - monitoring via position-monitor.ts for target/stop loss
          // No opposite signal exit logic - hold until target, stop loss, or momentum fading check triggers
          console.log(`⏸️  Position active (${activePosition.type === 'bullish' ? 'CE' : 'PE'}) - Waiting for target (+${config.TARGET_PERCENT}%), stop (-${config.STOP_PERCENT}%), or trailing stop (-${config.TRAILING_STOP_PERCENT}%)\n`);
        }
        // No active position - check for signals only during trading sessions
        else if (inTradingSession) {
          const sessionLabel = 'Trading Session';
          
          // Check for bullish signal (RSI-EMA crossover OR RSI threshold crossover)
          if (rsiEmaBullishSignal) {
            const isRsiEmaCross = prevRsi <= prevRsiEma && currentRsi > currentRsiEma;
            const isRsiThresholdCross = prevRsi <= config.RSI_OVERBOUGHT && currentRsi > config.RSI_OVERBOUGHT;
            
            console.log(`\n🟢 BULLISH SIGNAL DETECTED! [${sessionLabel}]`);
            if (isRsiEmaCross) {
              console.log(`   Type: Condition 1 - RSI-EMA Crossover (Available in all sessions)`);
              console.log(`   RSI crossed above RSI-EMA: ${prevRsi.toFixed(2)} → ${currentRsi.toFixed(2)} (EMA: ${currentRsiEma.toFixed(2)})`);
              console.log(`   RSI increase: ${(currentRsi - prevRsi).toFixed(2)} points (min: 3)`);
            }
            if (isRsiThresholdCross && allowThresholdSignals) {
              console.log(`   Type: Condition 2 - RSI Threshold Crossover (Session 1 ONLY)`);
              console.log(`   RSI crossed above ${config.RSI_OVERBOUGHT}: ${prevRsi.toFixed(2)} → ${currentRsi.toFixed(2)}`);
              console.log(`   RSI increase: ${(currentRsi - prevRsi).toFixed(2)} points (min: 3)`);
            }
            console.log(`   RSI-EMA difference: ${Math.abs(currentRsi - currentRsiEma).toFixed(2)} (min: ${config.MIN_RSI_EMA_DIFF})`);
            
            // ADX trend strength check
            const currentAdx = indicators.adx;
            console.log(`📊 ADX Trend Strength: ${currentAdx.toFixed(2)} (min: ${config.ADX_MIN_THRESHOLD})`);
            if (currentAdx < config.ADX_MIN_THRESHOLD) {
              console.log(`❌ BULLISH signal REJECTED - ADX ${currentAdx.toFixed(2)} below minimum ${config.ADX_MIN_THRESHOLD} (weak trend)\n`);
              continue; // Skip this signal and wait for next candle
            }
            console.log(`✅ ADX confirmation PASSED - Strong trend detected\n`);
            
            // Safety check: Clear any existing positions/orders before placing new order
            console.log('🔍 Safety check: Verifying no existing positions/orders before placing new order...');
            const posCheck: any = await getPositions();
            const ordCheck: any = await getOrderBook();
            
            let hasAnyPosition = false;
            let hasAnyOrder = false;
            
            if (posCheck && Array.isArray(posCheck)) {
              const openPos = posCheck.filter((p: any) => parseInt(p.netqty || '0') !== 0 && p.prd === 'M');
              if (openPos.length > 0) {
                hasAnyPosition = true;
                console.log(`   ⚠️  Found ${openPos.length} existing position(s) - will clear before placing new order`);
              }
            }
            
            if (ordCheck && Array.isArray(ordCheck)) {
              const pendingOrd = ordCheck.filter((o: any) => 
                o.status === 'PENDING' || o.status === 'OPEN' || o.status === 'TRIGGER_PENDING'
              );
              if (pendingOrd.length > 0) {
                hasAnyOrder = true;
                console.log(`   ⚠️  Found ${pendingOrd.length} pending order(s) - will clear before placing new order`);
              }
            }
            
            if (!hasAnyPosition && !hasAnyOrder) {
              console.log('   ✅ No existing positions/orders found - proceeding with new order');
            }
            
            // Place bullish order and track session
            activePosition = await handleMorningBullishSignal(config, activePosition, 'rsi-ema-crossover');
            
            // Add session and entry time tracking to active position
            if (activePosition && 'session' in activePosition) {
              activePosition.session = 1;
              activePosition.entryTime = DateTime.now().setZone('Asia/Kolkata');
              console.log(`   📊 Position opened in Session ${currentSession} at ${activePosition.entryTime.toFormat('HH:mm:ss')}`);
            }
          }
          // Check for bearish signal (RSI-EMA crossover OR RSI threshold crossover)
          else if (rsiEmaBearishSignal) {
            const isRsiEmaCross = prevRsi >= prevRsiEma && currentRsi < currentRsiEma;
            const isRsiThresholdCross = prevRsi >= 40 && currentRsi < 40;
            
            console.log(`\n🔴 BEARISH SIGNAL DETECTED! [${sessionLabel}]`);
            if (isRsiEmaCross) {
              console.log(`   Type: Condition 1 - RSI-EMA Crossover (Available in all sessions)`);
              console.log(`   RSI crossed below RSI-EMA: ${prevRsi.toFixed(2)} → ${currentRsi.toFixed(2)} (EMA: ${currentRsiEma.toFixed(2)})`);
              console.log(`   RSI decrease: ${(prevRsi - currentRsi).toFixed(2)} points (min: 3)`);
            }
            if (isRsiThresholdCross && allowThresholdSignals) {
              console.log(`   Type: Condition 2 - RSI Threshold Crossover (Session 1 ONLY)`);
              console.log(`   RSI decrease: ${(prevRsi - currentRsi).toFixed(2)} points (min: 3)`);
              console.log(`   RSI crossed below 40: ${prevRsi.toFixed(2)} → ${currentRsi.toFixed(2)}`);
            }
            console.log(`   RSI-EMA difference: ${Math.abs(currentRsi - currentRsiEma).toFixed(2)} (min: ${config.MIN_RSI_EMA_DIFF})`);
            
            // ADX trend strength check
            const currentAdx = indicators.adx;
            console.log(`📊 ADX Trend Strength: ${currentAdx.toFixed(2)} (min: ${config.ADX_MIN_THRESHOLD})`);
            if (currentAdx < config.ADX_MIN_THRESHOLD) {
              console.log(`❌ BEARISH signal REJECTED - ADX ${currentAdx.toFixed(2)} below minimum ${config.ADX_MIN_THRESHOLD} (weak trend)\n`);
              continue; // Skip this signal and wait for next candle
            }
            console.log(`✅ ADX confirmation PASSED - Strong trend detected\n`);
            
            // Safety check: Clear any existing positions/orders before placing new order
            console.log('🔍 Safety check: Verifying no existing positions/orders before placing new order...');
            const posCheck: any = await getPositions();
            const ordCheck: any = await getOrderBook();
            
            let hasAnyPosition = false;
            let hasAnyOrder = false;
            
            if (posCheck && Array.isArray(posCheck)) {
              const openPos = posCheck.filter((p: any) => parseInt(p.netqty || '0') !== 0 && p.prd === 'M');
              if (openPos.length > 0) {
                hasAnyPosition = true;
                console.log(`   ⚠️  Found ${openPos.length} existing position(s) - will clear before placing new order`);
              }
            }
            
            if (ordCheck && Array.isArray(ordCheck)) {
              const pendingOrd = ordCheck.filter((o: any) => 
                o.status === 'PENDING' || o.status === 'OPEN' || o.status === 'TRIGGER_PENDING'
              );
              if (pendingOrd.length > 0) {
                hasAnyOrder = true;
                console.log(`   ⚠️  Found ${pendingOrd.length} pending order(s) - will clear before placing new order`);
              }
            }
            
            if (!hasAnyPosition && !hasAnyOrder) {
              console.log('   ✅ No existing positions/orders found - proceeding with new order');
            }
            
            // Place bearish order and track session
            activePosition = await handleMorningBearishSignal(config, activePosition, 'rsi-ema-crossover');
            
            // Add session and entry time tracking to active position
            if (activePosition && 'session' in activePosition) {
              activePosition.session = 1;
              activePosition.entryTime = DateTime.now().setZone('Asia/Kolkata');
              console.log(`   📊 Position opened in Session ${currentSession} at ${activePosition.entryTime.toFormat('HH:mm:ss')}`);
            }
          } else {
            console.log(`⏸️  No RSI-EMA crossover signal detected in ${sessionLabel}\n`);
          }
        } else {
          // Not in trading session
          console.log('⏸️  Outside trading session - Signals are only checked during the configured session window\n');
        }
      } else {
        console.log(`⏳ First candle - storing values for next signal check\n`);
      }
      
      // Store current values as previous for next candle
      prevRsi = currentRsi;
      prevRsiEma = currentRsiEma;
    }
  }
}
