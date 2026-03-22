import { placeGttForExistingPositions, ExistingPositionInfo } from './order-handler';
import { 
  fetchYahooSeedCandles,
  fetchShoonyaHistoricalCandles,
  getHybridCandles,
  setHybridCandles,
  getLastCandleTime,
} from '../../services/stocks/instrument-updater';
import { connectShoonyaWebSocket } from '../../services/stocks/websocket-manager';
import { setCurrentInterval, setCandleStartTime } from '../../services/stocks/candle-config';
import { calculateRSI, calculateEMA } from './indicators';
import { MorningStrategyConfig } from '../config/morning-strategy-config';
import { filterCurrentExpiryOnly } from '../../services/stocks/instrument-filter';

// Only Morning Strategy is supported
type AnyStrategyConfig = MorningStrategyConfig;

/**
 * Step 1: Check existing positions and place GTT orders
 */
export async function initializeExistingPositions(config: AnyStrategyConfig): Promise<ExistingPositionInfo | null> {
  console.log('\n🔍 Checking for existing positions...');
  const existingPosition = await placeGttForExistingPositions(config.EXISTING_TARGET_PERCENT, config.EXISTING_STOP_PERCENT);
  return existingPosition;
}

/**
 * Step 2: Fetch historical candles from Shoonya API only (pure Shoonya data)
 */
export async function fetchHistoricalCandles(config: AnyStrategyConfig): Promise<void> {
  const requiredCandles = config.RSI_LENGTH + config.RSI_EMA_LENGTH + config.REQUIRED_CANDLES_BUFFER;
  console.log(`\n📥 Loading ${config.INTERVAL_MINUTES}-minute historical data for NIFTY 50 from Shoonya...`);
  
  // First try Shoonya API for consistency with Shoonya chart
  const seedCandles = await fetchShoonyaHistoricalCandles(
    config.NIFTY_TOKEN, 
    config.NIFTY_EXCHANGE, 
    config.INTERVAL_MINUTES, 
    requiredCandles
  );
  console.log(`   Shoonya candles fetched: ${seedCandles.length}`);
  let finalCandles = seedCandles;
  let usedYahooFallback = false;

  // If Shoonya did not return enough candles, optionally fill gaps from Yahoo
  const allowYahooFallback = String(process.env.ALLOW_YAHOO_FALLBACK || '').toLowerCase() === 'true';
  if (seedCandles.length < requiredCandles && allowYahooFallback) {
    console.log(`⚠️  Shoonya returned ${seedCandles.length}/${requiredCandles} candles. Trying Yahoo fallback...`);
    const yahooCandles = await fetchYahooSeedCandles('^NSEI', config.INTERVAL_MINUTES, requiredCandles);
    console.log(`   Yahoo candles fetched: ${yahooCandles.length}`);

    if (yahooCandles.length > 0) {
      usedYahooFallback = true;
      // Merge Yahoo + Shoonya candles, preferring latest data and de-duplicating by time
      const allCandles = [...yahooCandles, ...seedCandles];
      const byTime = new Map<number, typeof allCandles[number]>();
      for (const c of allCandles) {
        byTime.set(c.time, c);
      }
      finalCandles = Array.from(byTime.values()).sort((a, b) => a.time - b.time).slice(-requiredCandles);
      console.log(`✅ After Yahoo fallback we have ${finalCandles.length} candles`);
    } else {
      console.log('⚠️  Yahoo fallback enabled but returned no candles');
    }
  }
  
  if (finalCandles.length > 0) {
    setHybridCandles(finalCandles);
    const lastTime = getLastCandleTime();
    const lastCandleIST = new Date(lastTime!).toLocaleString('en-IN', { 
      timeZone: 'Asia/Kolkata',
      dateStyle: 'short',
      timeStyle: 'medium'
    });
    console.log(`✅ Loaded ${getHybridCandles().length} candles for initialization`);
    console.log(`   Last candle: ${lastCandleIST} IST`);
    if (usedYahooFallback && seedCandles.length > 0) {
      console.log('   Data source: Shoonya + Yahoo fallback');
    } else if (usedYahooFallback) {
      console.log('   Data source: Yahoo only (Shoonya returned no data)');
    } else {
      console.log('   Data source: Pure Shoonya (consistent with chart)');
    }
    console.log();
  } else {
    console.log('⚠️  No historical data available from Shoonya or Yahoo');
    console.log('   This is normal during weekends/holidays or before market open, or if APIs return no data');
    console.log('   Starting with live data only\n');
    setHybridCandles([]);
  }
}

/**
 * Step 3: Calculate and display initial RSI and RSI-EMA values
 */
export async function calculateInitialIndicators(config: AnyStrategyConfig): Promise<void> {
  console.log('\n📊 Calculating RSI indicators...');
  const candles = getHybridCandles();
  const initialCloses = candles.map(c => c.close);
  
  if (initialCloses.length >= config.RSI_LENGTH) {
    const initialRsiValues = calculateRSI(initialCloses, config.RSI_LENGTH);
    const initialRsi = initialRsiValues[initialRsiValues.length - 1];
    
    if (!isNaN(initialRsi)) {
      const validRsiValues = initialRsiValues.filter(v => !isNaN(v));
      
      // Try to calculate RSI-EMA if we have enough data
      if (validRsiValues.length >= config.RSI_EMA_LENGTH) {
        const initialRsiEmaValues = calculateEMA(validRsiValues, config.RSI_EMA_LENGTH);
        const initialRsiEma = initialRsiEmaValues[initialRsiEmaValues.length - 1];
        
        if (!isNaN(initialRsiEma)) {
          console.log(`✅ RSI: ${initialRsi.toFixed(2)} | RSI-EMA: ${initialRsiEma.toFixed(2)}\n`);
        }
      } else {
        console.log(`✅ RSI: ${initialRsi.toFixed(2)} (RSI-EMA calculating...)\n`);
      }
    }
  }
}

/**
 * Step 4: Connect to Shoonya WebSocket for live data
 */
export async function connectLiveDataFeed(config: AnyStrategyConfig): Promise<void> {
  console.log(`\n🔌 Connecting to live market data...`);
  
  // Set the current interval for candle building
  setCurrentInterval(config.INTERVAL_MINUTES);
  
  // Set the candle start time (9:15 AM for candle formation)
  const candleStartHour = (config as any).CANDLE_START_HOUR || config.START_HOUR;
  const candleStartMinute = (config as any).CANDLE_START_MINUTE || config.START_MINUTE;
  setCandleStartTime(candleStartHour, candleStartMinute);
  
  await connectShoonyaWebSocket(config.NIFTY_EXCHANGE, config.NIFTY_TOKEN);
  console.log(`✅ WebSocket connected - live ${config.INTERVAL_MINUTES}-minute candles will be built from real-time prices`);
  console.log(`   Candles aligned to ${candleStartHour}:${candleStartMinute.toString().padStart(2, '0')} start time`);
  
  // Show trading signals timing based on available config properties
  const signalStartHour = (config as any).SESSION1_START_HOUR || (config as any).START_HOUR;
  const signalStartMinute = (config as any).SESSION1_START_MINUTE || (config as any).START_MINUTE;
  if (signalStartHour !== undefined && signalStartMinute !== undefined) {
    console.log(`   Trading signals from ${signalStartHour}:${signalStartMinute.toString().padStart(2, '0')} onwards\n`);
  } else {
    console.log(`   Trading signals active during configured session windows\n`);
  }
}

/**
 * Run all initialization steps
 */
export async function initializeStrategy(config: AnyStrategyConfig): Promise<ExistingPositionInfo | null> {
  console.log('🚀 Starting NIFTY RSI/EMA Strategy with Shoonya LTP');
  console.log(`📊 Configuration: RSI_${config.RSI_LENGTH}, RSI_EMA_${config.RSI_EMA_LENGTH}, Interval=${config.INTERVAL_MINUTES}m`);
  
  // Filter instruments to keep only current expiry
  console.log('\n🔧 Step 0: Filtering instruments for current expiry only...');
  filterCurrentExpiryOnly();
  
  const existingPosition = await initializeExistingPositions(config);
  await fetchHistoricalCandles(config);
  await calculateInitialIndicators(config);
  await connectLiveDataFeed(config);
  
  console.log('🔄 Step 5: Starting main strategy loop (using successive candle data)...');
  console.log('   - Initial candles from Shoonya API (fallback: Yahoo API)');
  console.log('   - New candles added from Shoonya WebSocket prices\n');
  
  return existingPosition;
}
