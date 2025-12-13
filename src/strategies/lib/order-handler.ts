import { placeOrder, cancelOrder } from '../../services/orders/order';

export interface EntryResult {
  entry?: any;
  target?: any;
  stop?: any;
}

export async function placeEntryAndGTT(side: 'buy' | 'sell', instrument: any, ltp: number, targetPercent = 0.20, stopPercent = 0.05): Promise<EntryResult | null> {
  const qty = Number(instrument.Lotsize || instrument.lotsize || instrument.LotSize) || 1;
  const tsym = instrument.TradingSymbol || instrument.Symbol || instrument.Token || instrument.TradingSymbol;
  const exch = instrument.Exch || 'NFO';
  const prd = 'C';
  const trantype = side === 'buy' ? 'B' : 'S';
  const prctyp = 'MKT';

  console.log(`placeEntryAndGTT: side=${side} tsym=${tsym} qty=${qty} ltp=${ltp}`);

  // Live mode: always execute orders. Ensure credentials are configured in environment.

  try {
    const payload = {
      exch,
      tsym,
      qty: String(qty),
      trantype,
      prctyp,
      prd
    };

    const res = await placeOrder(payload as any);
    console.log('Entry order response:', res);

    if (!res || res.stat !== 'Ok' || !res.result) {
      console.error('Failed to place entry order', res);
      return null;
    }

    // place target and stop
    const entryPrice = Number(ltp || 0);
    const profitPrice = entryPrice * (1 + targetPercent); // target
    const stopPrice = entryPrice * (1 - stopPercent); // stop

    const targetPayload = {
      exch,
      tsym,
      qty: String(qty),
      trantype: side === 'buy' ? 'S' : 'B', // take opposite side for target
      prctyp: 'LMT',
      prc: String(profitPrice.toFixed(2)),
      prd
    };

    const stopPayload = {
      exch,
      tsym,
      qty: String(qty),
      trantype: side === 'buy' ? 'S' : 'B',
      prctyp: 'SL-MKT',
      trgprc: String(stopPrice.toFixed(2)),
      prd
    };

    const targetRes = await placeOrder(targetPayload as any);
    const stopRes = await placeOrder(stopPayload as any);

    console.log('Placed target order:', targetRes);
    console.log('Placed stop order:', stopRes);

    return { entry: res, target: targetRes, stop: stopRes };
  } catch (err) {
    console.error('Error placing entry/GTT orders:', err);
    return null;
  }
}

export async function cancelGttAndSquareOff(currentPosition: any): Promise<boolean> {
  if (!currentPosition) return false;

  const details = currentPosition.details || {};
  // Attempt to cancel GTT orders (target/stop)
  try {
    if (details.target && details.target.result) {
      const tRes = await cancelOrder({ norenordno: String(details.target.result) } as any);
      console.log('Canceled target GTT:', tRes);
    }
    if (details.stop && details.stop.result) {
      const sRes = await cancelOrder({ norenordno: String(details.stop.result) } as any);
      console.log('Canceled stop GTT:', sRes);
    }


    // To square off, attempt to place an opposite market order using instrument info
    const entry = details.entry || null;
    if (entry && entry.result) {
      // We have some info, but we might not have executed quantity. We'll place opposite MKT order to close.
      const tsym = currentPosition.instrument?.TradingSymbol || currentPosition.instrument?.Token || entry?.tsym;
      const qty = String(currentPosition.instrument?.Lotsize || currentPosition.instrument?.lotsize || 1);
      const side = currentPosition.type === 'CE' || currentPosition.type === 'PE' ? 'S' : 'S';
      const closePayload = {
        exch: 'NFO',
        tsym,
        qty,
        trantype: side,
        prctyp: 'MKT',
        prd: 'C'
      };
      const closeRes = await placeOrder(closePayload as any);
      console.log('Square off response:', closeRes);
    }

    return true;
  } catch (err) {
    console.error('Error canceling GTT or squaring off:', err);
    return false;
  }
}
