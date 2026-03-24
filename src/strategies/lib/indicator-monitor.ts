import { getHybridCandles } from '../../services/stocks/instrument-updater';
import { calculateRSI, calculateEMA, calculateADX } from './indicators';

export interface IndicatorValues {
  rsi: number;
  rsiEma: number;
  adx: number;
  prevRsi: number;
  prevRsiEma: number;
  validRsiValues: number[];
  rsiEmaValues: number[];
}

// Base config interface that both strategies share
interface BaseIndicatorConfig {
  RSI_LENGTH: number;
  RSI_EMA_LENGTH: number;
  ADX_LENGTH: number;
  INTERVAL_MINUTES: number;
}

/**
 * Calculate current RSI and RSI-EMA values from hybrid candles
 * Returns null if insufficient data or invalid values
 */
export function calculateCurrentIndicators(config: BaseIndicatorConfig): IndicatorValues | null {
  const candles = getHybridCandles();
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  
  // Need enough data for RSI, EMA, and ADX calculations
  if (closes.length < config.RSI_LENGTH + config.RSI_EMA_LENGTH + config.ADX_LENGTH) {
    return null;
  }
  
  // Calculate RSI for all candles
  const rsiValues = calculateRSI(closes, config.RSI_LENGTH);
  
  // Calculate EMA directly on the RSI array (with NaN values)
  // This keeps the arrays aligned with candles
  const rsiEmaValues = calculateEMA(rsiValues, config.RSI_EMA_LENGTH);
  
  // Calculate ADX
  const adxValues = calculateADX(highs, lows, closes, config.ADX_LENGTH);
  
  // Need at least two RSI/EMA values to compare consecutive candles
  if (rsiValues.length < 2 || rsiEmaValues.length < 2) {
    return null;
  }

  const lastIndex = rsiValues.length - 1;

  // Get the latest and previous values (strictly consecutive candles)
  const latestRsi = rsiValues[lastIndex];
  const latestRsiEma = rsiEmaValues[lastIndex];
  const prevRsi = rsiValues[lastIndex - 1];
  const prevRsiEma = rsiEmaValues[lastIndex - 1];
  const latestAdx = adxValues[adxValues.length - 1];
  
  // Validate
  if (isNaN(latestRsi) || isNaN(latestRsiEma) || isNaN(prevRsi) || isNaN(prevRsiEma) || isNaN(latestAdx)) {
    return null;
  }
  
  // Filter out NaN for backward compatibility
  const validRsiValues = rsiValues.filter(v => !isNaN(v));
  
  return {
    rsi: latestRsi,
    rsiEma: latestRsiEma,
    adx: latestAdx,
    prevRsi,
    prevRsiEma,
    validRsiValues,
    rsiEmaValues: rsiEmaValues.filter(v => !isNaN(v))
  };
}

/**
 * Print RSI and RSI-EMA values with timestamp and crossover analysis
 */
export function printIndicatorValues(
  config: BaseIndicatorConfig, 
  indicators: IndicatorValues
): void {
  const candles = getHybridCandles();
  
  // Get actual candle timestamps
  const currentCandleTime = candles.length > 0 ? candles[candles.length - 1].time : Date.now();
  const prevCandleTime = candles.length > 1 ? candles[candles.length - 2].time : currentCandleTime - (config.INTERVAL_MINUTES * 60 * 1000);
  
  const currentTime = new Date(currentCandleTime).toLocaleString('en-IN', { 
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
  
  const previousTime = new Date(prevCandleTime).toLocaleString('en-IN', { 
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
  
  // Use previous candle values from indicators
  if (!isNaN(indicators.prevRsi) && !isNaN(indicators.prevRsiEma)) {
    const prevCandle = candles.length > 1 ? candles[candles.length - 2] : null;
    console.log(`Prev => [${previousTime}] RSI: ${indicators.prevRsi.toFixed(2)} | RSI-EMA: ${indicators.prevRsiEma.toFixed(2)}${prevCandle ? ` | Close: ${prevCandle.close.toFixed(2)}` : ''}`);
  }
  const currentCandle = candles.length > 0 ? candles[candles.length - 1] : null;
  console.log(`Curr => [${currentTime}] RSI: ${indicators.rsi.toFixed(2)} | RSI-EMA: ${indicators.rsiEma.toFixed(2)} | ADX: ${indicators.adx.toFixed(2)}${currentCandle ? ` | Close: ${currentCandle.close.toFixed(2)}` : ''}`);
}

/**
 * Check if current candle volume is higher than average of previous N candles
 * Returns true if volume confirmation passes, false otherwise
 */
export function checkVolumeConfirmation(previousCandlesCount: number = 5): boolean {
  const candles = getHybridCandles();
  
  // Need at least previousCandlesCount + 1 candles (previous N + current)
  if (candles.length < previousCandlesCount + 1) {
    console.log(`⚠️  Volume check: Insufficient candles (need ${previousCandlesCount + 1}, have ${candles.length})`);
    return false;
  }
  
  // Get current candle (last one)
  const currentCandle = candles[candles.length - 1];
  
  // Get previous N candles (excluding current)
  const previousCandles = candles.slice(-(previousCandlesCount + 1), -1);
  
  // Calculate average volume of previous candles
  const avgVolume = previousCandles.reduce((sum, candle) => sum + candle.volume, 0) / previousCandles.length;
  
  // Check if current volume is higher than average
  const volumeConfirmed = currentCandle.volume > avgVolume;
  
  console.log(`📊 Volume Check:`);
  console.log(`   Current Volume: ${currentCandle.volume.toLocaleString()}`);
  console.log(`   Avg Previous ${previousCandlesCount}: ${avgVolume.toFixed(0).toLocaleString()}`);
  console.log(`   Ratio: ${(currentCandle.volume / avgVolume).toFixed(2)}x`);
  console.log(`   Result: ${volumeConfirmed ? '✅ PASSED (Volume > Average)' : '❌ FAILED (Volume <= Average)'}`);
  
  return volumeConfirmed;
}
