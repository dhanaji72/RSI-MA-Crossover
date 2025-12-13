
interface OptionInfo {
  instrument: any;
  ltp: number;
}

export const handleBullishSignal = async (
  currentPosition: any,
  findOptionNearPremium: (optionType: 'CE' | 'PE', premium: number) => Promise<OptionInfo | null>,
  placeEntryAndGTT: (side: 'buy' | 'sell', instrument: any, ltp: number, targetPercent?: number, stopPercent?: number) => Promise<any>,
  targetPremium: number,
  targetPercent: number,
  stopPercent: number
) => {
  if (currentPosition) return null;
  console.log('Bullish scenario handler: looking for CE instrument');
  const opt = await findOptionNearPremium('CE', targetPremium);
  if (!opt) {
    console.warn('Bullish handler: no CE instrument found');
    return null;
  }
  console.log('Bullish handler: placing entry for', opt.instrument.TradingSymbol || opt.instrument.Token);
  const res = await placeEntryAndGTT('buy', opt.instrument, opt.ltp, targetPercent, stopPercent);
  return res ? { type: 'CE', details: res } : null;
};
