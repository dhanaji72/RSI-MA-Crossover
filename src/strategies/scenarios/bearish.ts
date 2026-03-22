import { findOptionNearPremium } from '../lib/option-finder';
import { placeEntryAndGTT } from '../lib/order-handler';

interface BearishSignalParams {
  symbol?: string;
  exchange?: string;
  searchQuery?: string;
  targetPremium: number;
  targetPercent: number;
  stopPercent: number;
}

export const handleBearishSignal = async (params: BearishSignalParams) => {
  console.log('🐻 Bearish scenario handler: looking for PE option...');
  
  const opt = await findOptionNearPremium('PE', params.targetPremium);
  if (!opt) {
    console.warn('⚠️  Bearish handler: no PE option found');
    return null;
  }
  
  console.log(`✅ Bearish handler: placing entry for ${opt.instrument.TradingSymbol}`);
  const res = await placeEntryAndGTT('buy', opt.instrument, opt.ltp, params.targetPercent, params.stopPercent);
  
  return res ? { instrument: opt.instrument, details: res } : null;
};
