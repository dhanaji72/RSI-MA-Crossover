/**
 * Debug script to display current candles and RSI/EMA values
 * Run this to see what data your strategy is working with
 */
import { getHybridCandles } from './src/services/stocks/instrument-updater';
import { calculateRSI, calculateEMA } from './src/strategies/lib/indicators';
import { DateTime } from 'luxon';

function debugCandles() {
  const candles = getHybridCandles();
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 CANDLE DEBUG INFORMATION');
  console.log('='.repeat(80));
  
  console.log(`\nTotal candles: ${candles.length}`);
  
  if (candles.length === 0) {
    console.log('⚠️  No candles available yet!\n');
    return;
  }
  
  // Show first candle
  const firstCandle = candles[0];
  const firstTime = DateTime.fromMillis(firstCandle.time, { zone: 'Asia/Kolkata' });
  console.log(`\nFirst candle: ${firstTime.toFormat('yyyy-MM-dd HH:mm:ss')} IST`);
  console.log(`  O: ${firstCandle.open.toFixed(2)}, H: ${firstCandle.high.toFixed(2)}, L: ${firstCandle.low.toFixed(2)}, C: ${firstCandle.close.toFixed(2)}`);
  
  // Show last candle
  const lastCandle = candles[candles.length - 1];
  const lastTime = DateTime.fromMillis(lastCandle.time, { zone: 'Asia/Kolkata' });
  console.log(`\nLast candle: ${lastTime.toFormat('yyyy-MM-dd HH:mm:ss')} IST`);
  console.log(`  O: ${lastCandle.open.toFixed(2)}, H: ${lastCandle.high.toFixed(2)}, L: ${lastCandle.low.toFixed(2)}, C: ${lastCandle.close.toFixed(2)}`);
  
  // Show last 10 candles
  console.log(`\n📋 Last 10 candles:`);
  const last10 = candles.slice(-10);
  last10.forEach((candle, idx) => {
    const time = DateTime.fromMillis(candle.time, { zone: 'Asia/Kolkata' });
    console.log(`  ${idx + 1}. ${time.toFormat('HH:mm')} | O:${candle.open.toFixed(2)} H:${candle.high.toFixed(2)} L:${candle.low.toFixed(2)} C:${candle.close.toFixed(2)}`);
  });
  
  // Calculate RSI
  const closes = candles.map(c => c.close);
  const rsiValues = calculateRSI(closes, 14);
  const validRsi = rsiValues.filter(v => !isNaN(v));
  
  console.log(`\n📈 RSI_14 values (last 10):`);
  if (validRsi.length > 0) {
    const last10Rsi = validRsi.slice(-10);
    last10Rsi.forEach((rsi, idx) => {
      const candleIdx = candles.length - 10 + idx;
      if (candleIdx >= 0) {
        const time = DateTime.fromMillis(candles[candleIdx].time, { zone: 'Asia/Kolkata' });
        console.log(`  ${idx + 1}. ${time.toFormat('HH:mm')} | RSI: ${rsi.toFixed(2)}`);
      }
    });
  } else {
    console.log('  ⚠️  Not enough data for RSI calculation');
  }
  
  // Calculate RSI-EMA
  if (validRsi.length >= 21) {
    const rsiEmaValues = calculateEMA(validRsi, 21);
    const validRsiEma = rsiEmaValues.filter(v => !isNaN(v));
    
    console.log(`\n📊 RSI_EMA_21 values (last 10):`);
    const last10RsiEma = validRsiEma.slice(-10);
    last10RsiEma.forEach((ema, idx) => {
      const rsiIdx = validRsi.length - 10 + idx;
      if (rsiIdx >= 0) {
        const rsi = validRsi[rsiIdx];
        const candleIdx = candles.length - validRsiEma.length + validRsiEma.length - 10 + idx;
        if (candleIdx >= 0 && candleIdx < candles.length) {
          const time = DateTime.fromMillis(candles[candleIdx].time, { zone: 'Asia/Kolkata' });
          const crossStatus = rsi > ema ? '↑ RSI > EMA' : rsi < ema ? '↓ RSI < EMA' : '= Equal';
          console.log(`  ${idx + 1}. ${time.toFormat('HH:mm')} | RSI: ${rsi.toFixed(2)}, EMA: ${ema.toFixed(2)} ${crossStatus}`);
        }
      }
    });
    
    // Detect crossovers
    console.log(`\n🔍 CROSSOVER ANALYSIS (last 10):`);
    for (let i = 1; i < last10RsiEma.length; i++) {
      const prevRsi = validRsi[validRsi.length - 10 + i - 1];
      const currRsi = validRsi[validRsi.length - 10 + i];
      const prevEma = last10RsiEma[i - 1];
      const currEma = last10RsiEma[i];
      
      const bullishCross = prevRsi <= prevEma && currRsi > currEma;
      const bearishCross = prevRsi >= prevEma && currRsi < currEma;
      
      if (bullishCross || bearishCross) {
        const candleIdx = candles.length - 10 + i;
        if (candleIdx >= 0 && candleIdx < candles.length) {
          const time = DateTime.fromMillis(candles[candleIdx].time, { zone: 'Asia/Kolkata' });
          const type = bullishCross ? '🟢 BULLISH' : '🔴 BEARISH';
          console.log(`  ${time.toFormat('HH:mm')} ${type} CROSSOVER: ${prevRsi.toFixed(2)}→${currRsi.toFixed(2)} vs EMA ${prevEma.toFixed(2)}→${currEma.toFixed(2)}`);
        }
      }
    }
  } else {
    console.log(`\n⚠️  Not enough RSI data for RSI-EMA calculation (need 21, have ${validRsi.length})`);
  }
  
  console.log('\n' + '='.repeat(80) + '\n');
}

export { debugCandles };
