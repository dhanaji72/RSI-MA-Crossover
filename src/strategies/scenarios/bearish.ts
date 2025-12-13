
interface OptionInfo {
  instrument: any;
  ltp: number;
}

export const handleBearishSignal = async (
  currentPosition: any,
  findOptionNearPremium: (optionType: 'CE' | 'PE', premium: number) => Promise<OptionInfo | null>,
  placeEntryAndGTT: (side: 'buy' | 'sell', instrument: any, ltp: number, targetPercent?: number, stopPercent?: number) => Promise<any>,
  targetPremium: number,
  targetPercent: number,
  stopPercent: number
) => {
  if (currentPosition) return null;
  console.log('Bearish scenario handler: looking for PE instrument');
  const opt = await findOptionNearPremium('PE', targetPremium);
  if (!opt) {
    console.warn('Bearish handler: no PE instrument found');
    return null;
  }
  console.log('Bearish handler: placing entry for', opt.instrument.TradingSymbol || opt.instrument.Token);
  const res = await placeEntryAndGTT('buy', opt.instrument, opt.ltp, targetPercent, stopPercent);
  return res ? { type: 'PE', details: res } : null;
};
