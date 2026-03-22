import { findOptionNearPremium } from '../lib/option-finder';
import { placeEntryAndGTT } from '../lib/order-handler';

interface BullishSignalParams {
  symbol?: string;
  exchange?: string;
  searchQuery?: string;
  targetPremium: number;
  targetPercent: number;
  stopPercent: number;
}

export const handleBullishSignal = async (params: BullishSignalParams) => {
  console.log('🐂 Bullish scenario handler: looking for CE option...');
  
  const opt = await findOptionNearPremium('CE', params.targetPremium);
  if (!opt) {
    console.warn('⚠️  Bullish handler: no CE option found');
    return null;
  }
  
  console.log(`✅ Bullish handler: placing entry for ${opt.instrument.TradingSymbol}`);
  const res = await placeEntryAndGTT('buy', opt.instrument, opt.ltp, params.targetPercent, params.stopPercent);
  
  return res ? { instrument: opt.instrument, details: res } : null;
};
