import { placeOrder, cancelOrder, getPositions, getOrderBook } from '../../services/orders/order';

// ==================== DATA STRUCTURES ====================
// These define the shape of data we use in the strategy

export interface EntryResult {
  entry?: any;   // Details of the entry order (when we buy the option)
  target?: any;  // Details of the target order (when we sell at profit)
  stop?: any;    // Details of the stop loss order (when we sell at loss)
}

export interface ExistingPositionInfo {
  type: 'bullish' | 'bearish';  // Is this a Call (CE) or Put (PE) option?
  instrument: any;               // Which option contract we're holding
  details: any;                  // Order details (entry, target, stop)
}

// ==================== FUNCTION: CHECK AND PROTECT EXISTING POSITIONS ====================
// When the bot starts, it checks if we already have open positions from before
// If yes, it places stop loss orders to protect those positions
// targetPercent = How much profit we want (default 30%)
// stopPercent = Maximum loss we're willing to take (default 10%)
export async function placeGttForExistingPositions(targetPercent = 30, stopPercent = 10): Promise<ExistingPositionInfo | null> {
  try {
    console.log('🔍 Checking for existing positions...');
    
    // Ask the broker: "Do I have any open positions?"
    const positionsResponse: any = await getPositions();
    
    // If broker says error or no data, continue without existing positions
    if (!positionsResponse || positionsResponse.status === 'failed') {
      console.log('ℹ️  No existing positions found - Starting fresh\n');
      return null;
    }

    // Parse the broker's response and extract the list of positions
    let positions: any[] = [];
    if (Array.isArray(positionsResponse)) {
      positions = positionsResponse;
    } else if (positionsResponse.stat === 'Ok' && Array.isArray(positionsResponse.data)) {
      positions = positionsResponse.data;
    } else if (positionsResponse.stat === 'Not_Ok') {
      console.log('ℹ️  No existing positions found - Starting fresh\n');
      return null;
    } else {
      console.log('ℹ️  No existing positions found - Starting fresh\n');
      return null;
    }

    // Filter to find only NRML (Normal) positions that are not closed
    const openPositions = positions.filter((p: any) => {
      const netQty = parseInt(p.netqty || '0');
      return netQty !== 0 && p.prd === 'M'; // M = NRML product type
    });

    if (openPositions.length === 0) {
      console.log('ℹ️  No existing positions found - Starting fresh\n');
      return null;
    }

    console.log(`✅ Found ${openPositions.length} existing position(s)\n`);

    // Ask broker: "Do I have any pending orders?" (GTT = Good Till Triggered orders)
    const orderBookResponse: any = await getOrderBook();
    const pendingOrders = Array.isArray(orderBookResponse) 
      ? orderBookResponse.filter((o: any) => o.status === 'PENDING' || o.status === 'OPEN' || o.status === 'TRIGGER_PENDING')
      : [];

    // Price rounding: Options trade in multiples of 0.05 (5 paise)
    const tickSize = 0.05;
    const roundToTick = (price: number) => Math.round(price / tickSize) * tickSize;

    // Loop through each open position and protect it with stop loss
    for (const pos of openPositions) {
      const tsym = pos.tsym || '';                                    // Symbol name (e.g., NIFTY24DECCE23000)
      const netQty = Math.abs(parseInt(pos.netqty || '0'));          // Quantity we're holding
      const avgPrice = parseFloat(pos.netavgprc || pos.lp || '0');   // Price we bought at
      const exch = pos.exch || 'NFO';                                // Exchange (NFO = Derivatives)

      // Skip if data is incomplete
      if (!tsym || !avgPrice || netQty === 0) {
        continue;
      }

      // Check if we already have protection orders for this position
      const existingGttOrders = pendingOrders.filter((o: any) => 
        o.tsym === tsym && 
        (o.prctyp === 'LMT' || o.prctyp === 'SL-LMT') &&
        o.trantype !== 'B' // Exit orders (SELL orders)
      );

      if (existingGttOrders.length >= 2) {
        console.log(`ℹ️  ${tsym} - Protection orders already exist, skipping\n`);
        continue;
      }

      console.log(`📊 Position: ${tsym}`);
      console.log(`   Quantity: ${netQty}, Entry Price: ₹${avgPrice.toFixed(2)}`);

      // Check current market price to see if we're already in profit or loss
      const currentLtp = parseFloat(pos.lp || '0');  // LTP = Last Traded Price
      if (currentLtp > 0) {
        // Calculate profit/loss percentage: ((Current Price - Buy Price) / Buy Price) * 100
        const currentPnLPercent = ((currentLtp - avgPrice) / avgPrice) * 100;
        console.log(`   Current Price: ₹${currentLtp.toFixed(2)}, P&L: ${currentPnLPercent >= 0 ? '+' : ''}${currentPnLPercent.toFixed(2)}%`);
        
        // EMERGENCY EXIT: If already at stopPercent loss or more, sell immediately
        if (currentPnLPercent <= -stopPercent) {
          console.log(`   ⚠️  POSITION AT ${currentPnLPercent.toFixed(2)}% LOSS - Exiting immediately!\n`);
          
          // Place market order to exit the position NOW
          const squareOffPayload = {
            exch,
            tsym,
            qty: String(netQty),
            prc: '0',              // 0 = Market order (sell at whatever price available)
            trantype: 'S',         // S = SELL (exit our long position)
            prctyp: 'MKT',         // MKT = Market order type
            prd: 'M',              // M = NRML (Normal) product type
            ret: 'DAY'             // Order valid for today only
          };
          
          try {
            const squareOffRes = await placeOrder(squareOffPayload as any);
            if (squareOffRes?.stat === 'Ok') {
              console.log(`   ✅ Position Exited - Order ID: ${squareOffRes.norenordno}`);
              console.log(`   Waiting for next trading signal...\n`);
            } else {
              console.error(`   ❌ Exit Failed: ${squareOffRes?.emsg || 'Unknown error'}`);
            }
          } catch (err) {
            console.error(`   ❌ Error exiting position:`, err);
          }
          
          // Skip placing stop loss orders for this position (already exited)
          continue;
        }
      }

      // ===== CALCULATE PROTECTION LEVELS (PERCENTAGE-BASED) =====
      // We're holding a LONG position (bought CE or PE option)
      // Target = Price at which we want to book profit (targetPercent above buy price)
      // Stop = Price at which we want to cut loss (stopPercent below buy price)
      const targetPrice = roundToTick(avgPrice * (1 + targetPercent / 100));     // Example: ₹100 * 1.30 = ₹130
      const stopTriggerPrice = roundToTick(avgPrice * (1 - stopPercent / 100));  // Example: ₹100 * 0.90 = ₹90
      const stopPrice = stopTriggerPrice; // For SL-LMT, trigger and limit price are the same

      console.log(`   Target: ₹${targetPrice.toFixed(2)} (+${targetPercent}%), Stop Loss: ₹${stopTriggerPrice.toFixed(2)} (-${stopPercent}%)`);

      // ===== PLACE STOP LOSS ORDER =====
      // This is an automatic sell order that triggers if price falls to stop level
      // It protects us from losing more than stopPercent (10%)
      const stopPayload = {
        exch,
        tsym,
        qty: String(netQty),
        prc: String(stopPrice.toFixed(2)),          // Price at which to sell
        trantype: 'S',                               // S = SELL (to exit our long position)
        prctyp: 'SL-LMT',                           // SL-LMT = Stop Loss Limit order
        trgprc: String(stopTriggerPrice.toFixed(2)), // Trigger price (when to activate order)
        prd: 'M',                                    // M = NRML product type
        ret: 'DAY'                                   // Order valid for today only
      };

      console.log(`   📝 Placing stop loss protection order...`);
      const stopRes = await placeOrder(stopPayload as any);

      if (stopRes?.stat === 'Ok') {
        console.log(`   ✅ Stop Loss Active at ₹${stopPrice.toFixed(2)} (Order ID: ${stopRes.norenordno})`);
        console.log(`   ⏳ Target order will be placed when price reaches ₹${targetPrice.toFixed(2)}\n`);
      } else {
        console.error(`   ❌ Stop Loss Order Failed: ${stopRes?.emsg || 'Unknown error'}`);
      }
    }

    console.log('✅ Existing position protection complete\n');
    
    // Return info about the first position so we can track it in the main trading loop
    if (openPositions.length > 0) {
      const pos = openPositions[0];
      const tsym = pos.tsym || '';
      
      // Determine if it's a CE (Call) or PE (Put) option based on symbol name
      const isPE = tsym.includes('PE') || tsym.includes('P');
      const isCE = tsym.includes('CE') || tsym.includes('C');
      
      const positionType = isPE ? 'bearish' : (isCE ? 'bullish' : 'bullish');
      
      console.log(`📋 Tracking existing ${positionType.toUpperCase()} position: ${tsym}\n`);
      
      return {
        type: positionType,
        instrument: { TradingSymbol: tsym, Token: tsym },
        details: { entry: pos, target: null, stop: null }
      };
    }
    
    return null;
  } catch (err: any) {
    console.error('Error placing GTT for existing positions:', err?.message || err);
    console.log('Continuing with strategy...\n');
    return null;
  }
}

// ==================== FUNCTION: PLACE NEW TRADE (ENTRY + STOP LOSS) ====================
// This function is called when we get a trading signal (bullish or bearish crossover)
// It will BUY an option (CE or PE) and place a stop loss order to protect it
// Parameters:
//   side: 'buy' or 'sell' (we always BUY options, this parameter is legacy)
//   instrument: Which option contract to buy (e.g., NIFTY CE 23000)
//   ltp: Current market price of the option
//   targetPercent: Profit target (default 30%)
//   stopPercent: Maximum loss allowed (default 10%)
export async function placeEntryAndGTT(side: 'buy' | 'sell', instrument: any, ltp: number, targetPercent = 30, stopPercent = 10): Promise<EntryResult | null> {
  // Extract option details
  const lotSize = Number(instrument.Lotsize || instrument.lotsize || instrument.LotSize) || 1;
  const qty = lotSize * 1;  // 1 lot
  const tsym = instrument.TradingSymbol || instrument.Symbol || instrument.Token || instrument.TradingSymbol;
  const exch = instrument.Exch || 'NFO';  // NFO = National Stock Exchange F&O segment
  const prd = 'M';                        // M = NRML (Normal) product type
  const trantype = 'B';                   // B = BUY (we always buy options, never sell)
  const prctyp = 'MKT';                   // MKT = Market order (buy at current price)
  
  // ===== CALCULATE PROTECTION LEVELS (PERCENTAGE-BASED) =====
  // Price rounding: Options trade in multiples of ₹0.05 (5 paise)
  const tickSize = 0.05;
  const roundToTick = (price: number) => Math.round(price / tickSize) * tickSize;
  
  // Target: If we buy at ₹100, and targetPercent = 30%, target = ₹130
  // Stop: If we buy at ₹100, and stopPercent = 10%, stop = ₹90
  const targetPrice = roundToTick(ltp * (1 + targetPercent / 100));
  const stopLossPrice = roundToTick(ltp * (1 - stopPercent / 100));

  try {
    // ===== STEP 1: BUY THE OPTION =====
    const payload = {
      exch,                    // Exchange: NFO
      tsym,                    // Symbol: e.g., NIFTY24DECCE23000
      qty: String(qty),        // Quantity (number of lots)
      prc: '0',                // Price: 0 means market order (buy at current price)
      trantype,                // Transaction: B = BUY
      prctyp,                  // Price type: MKT = Market order
      prd,                     // Product: M = NRML
      ret: 'DAY'               // Retention: Order valid for today only
    };

    console.log(`\n📝 Placing BUY order for ${tsym}...`);
    const res = await placeOrder(payload as any);
    
    // Check if order was successful - handle both success and rejection cases
    if (!res) {
      console.error(`❌ Order Failed: No response received`);
      return null;
    }
    
    // Check for explicit rejection
    if (res.stat === 'Not_Ok') {
      console.error(`❌ Order REJECTED: ${res.emsg || 'Unknown error'}`);
      return null;
    }
    
    // Check for success with order number
    if (res.stat !== 'Ok' || !res.norenordno) {
      console.error(`❌ Order Failed: ${res.emsg || res.stat || 'Unknown error'}`);
      return null;
    }

    console.log(`✅ ORDER PLACED SUCCESSFULLY`);
    console.log(`   Order ID: ${res.norenordno}`);
    console.log(`   ${tsym} - Qty: ${qty} @ ₹${ltp.toFixed(2)}`);
    console.log(`   Target: ₹${targetPrice.toFixed(2)} (+${targetPercent}%), Stop Loss: ₹${stopLossPrice.toFixed(2)} (-${stopPercent}%)`);

    // ===== STEP 2: PLACE STOP LOSS ORDER (PROTECTION) =====
    // We DON'T place target order immediately. Why?
    // - Stop loss is placed NOW to protect us from loss immediately
    // - Target order is placed LATER when price reaches target (see position-monitor.ts)
    // This two-stage approach:
    //   Stage 1: Stop loss protects us from downside (-10% loss)
    //   Stage 2: When price hits target (+20% profit), we cancel stop loss and place target order
    
    const profitPrice = targetPrice;      // Will use this later for target order
    const stopPrice = stopLossPrice;      // Will use this now for stop loss order

    // Create stop loss order details
    const stopPayload = {
      exch,                                 // Exchange: NFO
      tsym,                                 // Symbol
      qty: String(qty),                     // Quantity
      prc: String(stopPrice.toFixed(2)),    // Limit price: ₹90 (if we bought at ₹100)
      trantype: 'S',                        // S = SELL (to exit our long position)
      prctyp: 'SL-LMT',                     // SL-LMT = Stop Loss Limit order
      trgprc: String(stopPrice.toFixed(2)), // Trigger: When price falls to ₹90, activate order
      prd,                                  // Product: NRML
      ret: 'DAY'                            // Valid for today only
    };

    console.log(`📝 Placing STOP LOSS order...`);
    const stopRes = await placeOrder(stopPayload as any);

    if (stopRes?.stat === 'Not_Ok') {
      console.error(`❌ Stop Loss Order REJECTED: ${stopRes.emsg || 'Unknown error'}`);
    } else if (stopRes?.stat === 'Ok' && stopRes.norenordno) {
      console.log(`✅ Stop Loss Active at ₹${stopPrice.toFixed(2)} (Order ID: ${stopRes.norenordno})`);
      console.log(`⏳ Target order will be placed automatically when price reaches ₹${profitPrice.toFixed(2)}\n`);
    } else {
      console.error(`❌ Stop Loss Order Failed: ${stopRes?.emsg || stopRes?.stat || 'Unknown error'}`);
    }

    // Return details of entry and stop loss orders (target will be placed later)
    return { entry: res, target: null, stop: stopRes };
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
    console.log('📝 Canceling existing GTT orders...');
    
    if (details.target && details.target.norenordno) {
      const tRes = await cancelOrder({ norenordno: String(details.target.norenordno) } as any);
      if (tRes?.stat === 'Ok') {
        console.log(`✅ Target order canceled: ${details.target.norenordno}`);
      } else {
        console.log(`⚠️  Target order cancel failed: ${tRes?.emsg || 'Unknown'}`);
      }
    }
    
    if (details.stop && details.stop.norenordno) {
      const sRes = await cancelOrder({ norenordno: String(details.stop.norenordno) } as any);
      if (sRes?.stat === 'Ok') {
        console.log(`✅ Stop loss order canceled: ${details.stop.norenordno}`);
      } else {
        console.log(`⚠️  Stop loss cancel failed: ${sRes?.emsg || 'Unknown'}`);
      }
    }


    // To square off, attempt to place an opposite market order using instrument info
    const entry = details.entry || null;
    if (entry && entry.result) {
      // We have some info, but we might not have executed quantity. We'll place opposite MKT order to close.
      const tsym = currentPosition.instrument?.TradingSymbol || currentPosition.instrument?.Token || entry?.tsym;
      const lotSize = Number(currentPosition.instrument?.Lotsize || currentPosition.instrument?.lotsize || 1);
      const qty = String(lotSize * 1);  // 1 lot
      const side = currentPosition.type === 'CE' || currentPosition.type === 'PE' ? 'S' : 'S';
      const closePayload = {
        exch: 'NFO',
        tsym,
        qty,
        prc: '0',
        trantype: side,
        prctyp: 'MKT',
        prd: 'M',
        ret: 'DAY'
      };
      console.log(`📝 Placing square-off order for ${tsym}...`);
      const closeRes = await placeOrder(closePayload as any);
      
      if (closeRes?.stat === 'Ok') {
        console.log(`✅ SQUARE-OFF ORDER PLACED:`);
        console.log(`   Order ID: ${closeRes.norenordno}`);
        console.log(`   Type: ${side} ${qty} x ${tsym}`);
      } else {
        console.error('❌ SQUARE-OFF ORDER FAILED:', closeRes?.emsg || closeRes);
      }
    }

    return true;
  } catch (err) {
    console.error('Error canceling GTT or squaring off:', err);
    return false;
  }
}
