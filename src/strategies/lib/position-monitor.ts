import { getPositions, cancelOrder, placeOrder, getOrderBook } from '../../services/orders/order';
import { MORNING_STRATEGY_CONFIG } from '../config/morning-strategy-config';

// ==================== DATA STRUCTURE ====================
interface ActivePosition {
  type: 'bullish' | 'bearish';  // CE (Call) = bullish, PE (Put) = bearish
  details: any;                  // Order details
  instrument: any;               // Which option we're holding
  highestPrice?: number;         // Highest price reached for trailing stop
  entryPrice?: number;           // Entry price for trailing stop calculation
  profitLocked?: boolean;        // Whether minimum profit has been locked
  entryTime?: number;            // Entry timestamp for momentum fading check
  session?: 1 | 2;               // Which trading session (1 or 2)
}

// ==================== RATE LIMITING FOR API CALLS ====================
// Check positions every 2 seconds for quick target/stop loss detection
let lastPositionFetchTime = 0;
const POSITION_FETCH_INTERVAL = 2000; // 2 seconds

// ==================== FUNCTION: MONITOR POSITIONS ====================
// This function checks our open positions and takes action if needed:
// 1. If position is closed (stop loss or target hit) → Clean up
// 2. If target price reached → Cancel stop loss, place target order
// 3. If trailing stop loss breached → Exit position to protect profit
// 4. If initial stop loss breached → Exit position immediately
//
// Parameters:
//   activePosition: The position we're currently holding (null if no position)
//   stopPercent: Maximum loss we allow (default 15%)
//   targetPercent: Profit target (default 200%)
//   trailingStopPercent: Trailing stop from highest price (default 10%)
//   minProfitLockPercent: % move from entry required before profit lock starts (default 10)
//   lockedProfitPercent: % of entry price to lock once profit lock triggers (default 5)
//
// Returns: Updated position info (or null if position closed)
export async function monitorAndSquareOffLosses(
  activePosition: ActivePosition | null,
  stopPercent: number = 15,
  targetPercent: number = 200,
  trailingStopPercent: number = 10,
  minProfitLockPercent: number = 10,
  lockedProfitPercent: number = 5
): Promise<ActivePosition | null> {
  // If we don't have any position, nothing to monitor
  if (!activePosition) {
    return null;
  }

  // ===== RATE LIMITING: Don't call API too frequently =====
  // Skip this check if we called the broker's API less than 60 seconds ago
  const now = Date.now();
  if (now - lastPositionFetchTime < POSITION_FETCH_INTERVAL) {
    return activePosition; // Skip this monitoring cycle
  }

  try {
    // Remember when we last fetched positions
    lastPositionFetchTime = now;
    
    // Ask broker: "What positions do I have?" and "What pending orders?"
    const positionsResponse: any = await getPositions();
    const orderBookResponse: any = await getOrderBook();
    
    // Validate broker response
    if (!positionsResponse || !Array.isArray(positionsResponse)) {
      return activePosition; // Data error, keep current position tracking
    }

    // Filter to get only open NRML positions (not closed/squared off)
    const openPositions = positionsResponse.filter((pos: any) => {
      const netQty = parseInt(pos.netqty || '0');
      return netQty !== 0 && pos.prd === 'M'; // M = NRML product
    });

    // ===== CHECK IF OUR POSITION STILL EXISTS =====
    // Look for the option we're holding in the list of open positions
    const instrumentSymbol = activePosition.instrument?.TradingSymbol || '';
    const matchingPosition = openPositions.find((pos: any) => 
      pos.tsym === instrumentSymbol
    );

    // ===== SCENARIO 1: POSITION CLOSED (Stop loss or Target hit) =====
    if (!matchingPosition) {
      console.log(`\n💼 Position Closed: ${instrumentSymbol}`);
      
      // Clean up: Cancel any leftover pending orders for this option (fetch fresh order book)
      console.log('📋 Fetching fresh order book for cleanup...');
      const cleanupOrderBook: any = await getOrderBook();
      
      if (cleanupOrderBook && Array.isArray(cleanupOrderBook)) {
        const pendingOrders = cleanupOrderBook.filter((order: any) => 
          order.tsym === instrumentSymbol &&
          (order.status === 'PENDING' || order.status === 'OPEN' || order.status === 'TRIGGER_PENDING')
        );

        if (pendingOrders.length > 0) {
          console.log(`   Found ${pendingOrders.length} pending order(s) to cancel`);
          for (const order of pendingOrders) {
            try {
              await cancelOrder({ norenordno: String(order.norenordno) } as any);
              console.log(`   ✅ Cancelled order: ${order.norenordno}`);
            } catch (err) {
              console.error(`   ❌ Error cancelling order:`, err);
            }
          }
        }
      }
      
      console.log(`📊 Waiting for next trading signal...\n`);
      return null; // Position closed, stop monitoring
    }

    // ===== POSITION STILL OPEN: Get current details =====
    const avgPrice = parseFloat(matchingPosition.netavgprc || '0');    // Price we bought at
    const currentLtp = parseFloat(matchingPosition.lp || '0');         // Current market price
    const netQty = Math.abs(parseInt(matchingPosition.netqty || '0')); // Quantity we're holding

    // Skip if data is incomplete
    if (avgPrice === 0 || currentLtp === 0) {
      return activePosition;
    }

    // Price rounding for target price calculation
    const tickSize = 0.05;
    const roundToTick = (price: number) => Math.round(price / tickSize) * tickSize;

    // Initialize entry price and highest price tracking for trailing stop
    if (!activePosition.entryPrice) {
      activePosition.entryPrice = avgPrice;
    }
    if (!activePosition.highestPrice) {
      activePosition.highestPrice = currentLtp;
    }
    
    // Initialize entry time for momentum fading check
    if (!activePosition.entryTime) {
      activePosition.entryTime = Date.now();
    }
    
    // ===== SESSION-BASED TIME EXIT =====
    // Force exit at session end time if target/stop not hit
    if (activePosition.session) {
      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const currentMinutes = nowIST.getHours() * 60 + nowIST.getMinutes();
      
      const exitTimeMinutes = MORNING_STRATEGY_CONFIG.SESSION_EXIT_HOUR * 60 + MORNING_STRATEGY_CONFIG.SESSION_EXIT_MINUTE;
      const exitHour24 = MORNING_STRATEGY_CONFIG.SESSION_EXIT_HOUR;
      const exitMinute = MORNING_STRATEGY_CONFIG.SESSION_EXIT_MINUTE;
      const exitHour12 = exitHour24 > 12 ? exitHour24 - 12 : exitHour24;
      const exitAmPm = exitHour24 >= 12 ? 'PM' : 'AM';
      const exitTimeLabel = `${exitHour12}:${String(exitMinute).padStart(2, '0')} ${exitAmPm}`;
      
      // Check if current time is past session exit time
      if (exitTimeMinutes > 0 && currentMinutes >= exitTimeMinutes) {
        console.log(`\n⏰ SESSION ${activePosition.session} EXIT TIME REACHED (${exitTimeLabel})!`);
        console.log(`   ${matchingPosition.tsym}`);
        console.log(`   Current Time: ${nowIST.getHours()}:${String(nowIST.getMinutes()).padStart(2, '0')}`);
        console.log(`   Entry: ₹${activePosition.entryPrice.toFixed(2)}, Current: ₹${currentLtp.toFixed(2)}`);
        
        const currentProfitPercent = ((currentLtp - activePosition.entryPrice) / activePosition.entryPrice) * 100;
        console.log(`   P&L: ${currentProfitPercent >= 0 ? '+' : ''}${currentProfitPercent.toFixed(2)}%`);
        console.log(`   Exiting position due to session time limit...\n`);
        
        // Cancel all pending orders
        console.log('📋 Fetching fresh order book to cancel all pending orders...');
        const freshOrderBookForTime: any = await getOrderBook();
        
        if (freshOrderBookForTime && Array.isArray(freshOrderBookForTime)) {
          const pendingOrders = freshOrderBookForTime.filter((order: any) => 
            order.tsym === matchingPosition.tsym &&
            (order.status === 'PENDING' || order.status === 'OPEN' || order.status === 'TRIGGER_PENDING')
          );

          if (pendingOrders.length > 0) {
            console.log(`   Cancelling ${pendingOrders.length} pending order(s)...`);
          }

          for (const order of pendingOrders) {
            try {
              console.log(`   Cancelling order: ${order.norenordno}`);
              await cancelOrder({ norenordno: String(order.norenordno) } as any);
              console.log(`   ✅ Cancelled`);
            } catch (err) {
              console.error(`   ❌ Error cancelling order:`, err);
            }
          }
        }

        // Exit position at market price
        console.log(`📝 Exiting position at market price...`);
        const timeSquareOffPayload = {
          exch: matchingPosition.exch,
          tsym: matchingPosition.tsym,
          qty: String(netQty),
          prc: '0',
          trantype: 'S',
          prctyp: 'MKT',
          prd: 'M',
          ret: 'DAY'
        };

        try {
          const timeSquareOffRes = await placeOrder(timeSquareOffPayload as any);
          if (timeSquareOffRes?.stat === 'Ok') {
            console.log(`✅ Time-Based Exit Order Placed - Order ID: ${timeSquareOffRes.norenordno}`);
            console.log(`   Session ${activePosition.session} Closed at ${exitTimeLabel}`);
            console.log(`   Final P&L: ${currentProfitPercent >= 0 ? '+' : ''}${currentProfitPercent.toFixed(2)}%\n`);
            return null;
          } else {
            console.error(`❌ Time Exit Failed: ${timeSquareOffRes?.emsg || 'Unknown error'}`);
            return activePosition;
          }
        } catch (err) {
          console.error(`❌ Error exiting position:`, err);
          return activePosition;
        }
      }
    }
    
    // ===== MOMENTUM FADING CHECK =====
    // Exit if position doesn't hit required profit % within configured time window
    if (activePosition.entryTime && minProfitLockPercent > 0) {
      const minutesSinceEntry = (Date.now() - activePosition.entryTime) / (1000 * 60);
      const momentumCheckMinutes = MORNING_STRATEGY_CONFIG.MOMENTUM_CHECK_MINUTES;
      const momentumCheckPercent = MORNING_STRATEGY_CONFIG.MOMENTUM_CHECK_PERCENT;
      
      if (minutesSinceEntry >= momentumCheckMinutes) {
        const currentProfitPercent = ((currentLtp - activePosition.entryPrice) / activePosition.entryPrice) * 100;
        
        if (currentProfitPercent < momentumCheckPercent) {
          console.log(`\n⚠️  MOMENTUM FADING DETECTED!`);
          console.log(`   ${matchingPosition.tsym}`);
          console.log(`   Time since entry: ${minutesSinceEntry.toFixed(1)} minutes`);
          console.log(`   Current profit: ${currentProfitPercent.toFixed(2)}% (Required: ${momentumCheckPercent}%)`);
          console.log(`   Entry: ₹${activePosition.entryPrice.toFixed(2)}, Current: ₹${currentLtp.toFixed(2)}`);
          console.log(`   Exiting position due to fading momentum...\n`);
          
          // Cancel all pending orders
          console.log('📋 Fetching fresh order book to cancel all pending orders...');
          const freshOrderBookForMomentum: any = await getOrderBook();
          
          if (freshOrderBookForMomentum && Array.isArray(freshOrderBookForMomentum)) {
            const pendingOrders = freshOrderBookForMomentum.filter((order: any) => 
              order.tsym === matchingPosition.tsym &&
              (order.status === 'PENDING' || order.status === 'OPEN' || order.status === 'TRIGGER_PENDING')
            );

            if (pendingOrders.length > 0) {
              console.log(`   Cancelling ${pendingOrders.length} pending order(s)...`);
            }

            for (const order of pendingOrders) {
              try {
                console.log(`   Cancelling order: ${order.norenordno}`);
                await cancelOrder({ norenordno: String(order.norenordno) } as any);
                console.log(`   ✅ Cancelled`);
              } catch (err) {
                console.error(`   ❌ Error cancelling order:`, err);
              }
            }
          }

          // Exit position at market price
          console.log(`📝 Exiting position at market price...`);
          const momentumSquareOffPayload = {
            exch: matchingPosition.exch,
            tsym: matchingPosition.tsym,
            qty: String(netQty),
            prc: '0',
            trantype: 'S',
            prctyp: 'MKT',
            prd: 'M',
            ret: 'DAY'
          };

          try {
            const momentumSquareOffRes = await placeOrder(momentumSquareOffPayload as any);
            if (momentumSquareOffRes?.stat === 'Ok') {
              console.log(`✅ Momentum Exit Order Placed - Order ID: ${momentumSquareOffRes.norenordno}`);
              console.log(`   Final P&L: ${currentProfitPercent >= 0 ? '+' : ''}${currentProfitPercent.toFixed(2)}%\n`);
              return null;
            } else {
              console.error(`❌ Momentum Exit Failed: ${momentumSquareOffRes?.emsg || 'Unknown error'}`);
              return activePosition;
            }
          } catch (err) {
            console.error(`❌ Error exiting position:`, err);
            return activePosition;
          }
        }
      }
    }

    // Update highest price if current price is higher
    if (currentLtp > activePosition.highestPrice) {
      activePosition.highestPrice = currentLtp;

      const entryPrice = activePosition.entryPrice!;
      const minProfitLockPoints = entryPrice * (minProfitLockPercent / 100);
      const lockedProfitPoints = entryPrice * (lockedProfitPercent / 100);

      // Check if we reached minimum profit lock threshold (based on % move from entry)
      const profitPoints = currentLtp - entryPrice;
      const profitPercent = (profitPoints / entryPrice) * 100;

      if (profitPoints >= minProfitLockPoints && !activePosition.profitLocked) {
        activePosition.profitLocked = true;
        // Lock at entry + lockedProfitPoints, then continue trailing from there
        const lockedPrice = roundToTick(entryPrice + lockedProfitPoints);
        console.log(`\n🔒 PROFIT LOCKED! Price reached ₹${currentLtp.toFixed(2)} (+${profitPoints.toFixed(2)} points, +${profitPercent.toFixed(2)}%)`);
        console.log(`   Lock trigger: +${minProfitLockPercent}% of entry (≈ ${minProfitLockPoints.toFixed(2)} points)`);
        console.log(`   Stop locked at: ₹${lockedPrice.toFixed(2)} (entry + ${lockedProfitPoints.toFixed(2)} points, ${lockedProfitPercent}% of entry)`);
        console.log(`   Trailing continues from this point with ${trailingStopPercent}% distance\n`);
      }
    }
    
    // ===== CALCULATE PROFIT/LOSS (PERCENTAGE-BASED) =====
    // We're holding LONG positions (bought CE or PE options)
    // Profit/Loss % = ((Current Price - Buy Price) / Buy Price) * 100
    // Example: Bought at ₹100, now at ₹110 → P&L = +10%
    const pnlPercent = ((currentLtp - avgPrice) / avgPrice) * 100;
    
    // Calculate target price: If we bought at ₹100 and targetPercent = 30%, target = ₹130
    const targetPrice = roundToTick(avgPrice * (1 + targetPercent / 100));
    
    // Check if current price has reached our target
    const targetReached = currentLtp >= targetPrice;
    
    // ===== SCENARIO 2: TARGET PRICE REACHED (Book Profit!) =====
    if (targetReached) {
      console.log(`\n🎯 TARGET REACHED!`);
      console.log(`   ${matchingPosition.tsym}`);
      console.log(`   Entry: ₹${avgPrice.toFixed(2)} → Current: ₹${currentLtp.toFixed(2)}`);
      console.log(`   Profit: +${pnlPercent.toFixed(2)}%`);
      
      // STEP 1: Cancel the stop loss order (no longer needed)
      console.log('📋 Fetching fresh order book to cancel stop loss orders...');
      const freshOrderBook: any = await getOrderBook();
      
      if (freshOrderBook && Array.isArray(freshOrderBook)) {
        const stopLossOrders = freshOrderBook.filter((order: any) => 
          order.tsym === matchingPosition.tsym &&
          order.prctyp === 'SL-LMT' &&
          (order.status === 'PENDING' || order.status === 'OPEN' || order.status === 'TRIGGER_PENDING')
        );

        if (stopLossOrders.length > 0) {
          console.log(`   Cancelling ${stopLossOrders.length} stop loss order(s)...`);
        }

        for (const order of stopLossOrders) {
          try {
            console.log(`   Cancelling SL order: ${order.norenordno}`);
            await cancelOrder({ norenordno: String(order.norenordno) } as any);
            console.log(`   ✅ Cancelled`);
          } catch (err) {
            console.error(`   ❌ Error cancelling order:`, err);
          }
        }
      }

      // STEP 2: Place target order to lock in profit
      console.log(`📝 Placing target order to book profit...`);
      const targetPayload = {
        exch: matchingPosition.exch,
        tsym: matchingPosition.tsym,
        qty: String(netQty),
        prc: String(targetPrice.toFixed(2)),
        trantype: 'S', // SELL to exit long option position
        prctyp: 'LMT',
        prd: 'M',
        ret: 'DAY'
      };
      
      try {
        const targetRes = await placeOrder(targetPayload as any);
        if (targetRes?.stat === 'Ok') {
          console.log(`✅ Target Order Placed - Order ID: ${targetRes.norenordno}`);
          console.log(`   Selling at ₹${targetPrice.toFixed(2)}\n`);
        } else {
          console.error(`❌ Target Order Failed: ${targetRes?.emsg || 'Unknown error'}`);
        }
      } catch (err) {
        console.error(`❌ Error placing target order:`, err);
      }
      
      return activePosition;
    }
    
    // ===== SCENARIO 3: STOP LOSS BREACHED (Cut Loss) =====
    // Check if stop loss is breached (loss of stopPercent or worse)
    if (pnlPercent <= -stopPercent) {
      console.log(`\n🛑 STOP LOSS TRIGGERED!`);
      console.log(`   ${matchingPosition.tsym} (LONG)`);
      console.log(`   Entry: ₹${avgPrice.toFixed(2)} → Current: ₹${currentLtp.toFixed(2)}`);
      console.log(`   Loss: ${pnlPercent.toFixed(2)}%`);
      
      // STEP 1: Cancel all pending orders (fetch fresh order book)
      console.log('📋 Fetching fresh order book to cancel all pending orders...');
      const freshOrderBookForSL: any = await getOrderBook();
      
      if (freshOrderBookForSL && Array.isArray(freshOrderBookForSL)) {
        const pendingOrders = freshOrderBookForSL.filter((order: any) => 
          order.tsym === matchingPosition.tsym &&
          (order.status === 'PENDING' || order.status === 'OPEN' || order.status === 'TRIGGER_PENDING')
        );

        if (pendingOrders.length > 0) {
          console.log(`   Cancelling ${pendingOrders.length} pending order(s)...`);
        }

        for (const order of pendingOrders) {
          try {
            console.log(`   Cancelling order: ${order.norenordno}`);
            await cancelOrder({ norenordno: String(order.norenordno) } as any);
            console.log(`   ✅ Cancelled`);
          } catch (err) {
            console.error(`   ❌ Error cancelling order:`, err);
          }
        }
      }

      // STEP 2: Exit position immediately at market price
      console.log(`📝 Exiting position to limit loss...`);
      const squareOffPayload = {
        exch: matchingPosition.exch,
        tsym: matchingPosition.tsym,
        qty: String(netQty),
        prc: '0',
        trantype: 'S', // SELL to exit long option position
        prctyp: 'MKT',
        prd: 'M',
        ret: 'DAY'
      };

      try {
        const squareOffRes = await placeOrder(squareOffPayload as any);
        if (squareOffRes?.stat === 'Ok') {
          console.log(`✅ Stop Loss Exit Order Placed - Order ID: ${squareOffRes.norenordno}`);
          console.log(`   Loss: ${pnlPercent.toFixed(2)}%\n`);
          
          // STEP 3: Verify position and orders are fully cleared
          console.log('⏳ Verifying position is fully closed...');
          let retries = 0;
          const maxRetries = 5;
          let positionCleared = false;
          
          // Helper function to sleep
          const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
          
          while (retries < maxRetries && !positionCleared) {
            await sleep(1000);
            
            const verifyPos: any = await getPositions();
            const verifyOrders: any = await getOrderBook();
            
            let stillHasPosition = false;
            
            // Check if position still exists
            if (verifyPos && Array.isArray(verifyPos)) {
              const remainingPos = verifyPos.filter((p: any) => 
                parseInt(p.netqty || '0') !== 0 && 
                p.prd === 'M' && 
                p.tsym === matchingPosition.tsym
              );
              if (remainingPos.length > 0) {
                stillHasPosition = true;
                console.log(`   ⚠️  Position still open - retry ${retries + 1}/${maxRetries}`);
              }
            }
            
            // Check for pending orders
            if (verifyOrders && Array.isArray(verifyOrders)) {
              const pendingOrds = verifyOrders.filter((o: any) =>
                (o.status === 'PENDING' || o.status === 'OPEN' || o.status === 'TRIGGER_PENDING') &&
                o.tsym === matchingPosition.tsym
              );
              if (pendingOrds.length > 0) {
                stillHasPosition = true;
                console.log(`   ⚠️  Found ${pendingOrds.length} pending order(s) - retry ${retries + 1}/${maxRetries}`);
              }
            }
            
            if (!stillHasPosition) {
              positionCleared = true;
              console.log('✅ Position and orders fully cleared - Stop loss executed successfully\n');
            } else {
              retries++;
            }
          }
          
          if (!positionCleared) {
            console.log('⚠️  WARNING: Could not verify full position cleanup after max retries');
            console.log('   Position may still be open - manual verification recommended\n');
            return activePosition; // Keep monitoring
          }
          
          return null; // Position confirmed closed
        } else {
          console.error(`❌ Exit Failed: ${squareOffRes?.emsg || 'Unknown error'}`);
          return activePosition;
        }
      } catch (err) {
        console.error(`❌ Error exiting position:`, err);
        return activePosition;
      }
    }

    // ===== SCENARIO 4: TRAILING STOP LOSS BREACHED (Protect Profit) =====
    // Calculate trailing stop: highest price - (trailingStopPercent of original entry price)
    const entryPrice = activePosition.entryPrice!;
    const trailingStopPrice = roundToTick(activePosition.highestPrice - (entryPrice * trailingStopPercent / 100));
    const initialStopPrice = roundToTick(avgPrice * (1 - stopPercent / 100));
    
    // If profit is locked, ensure stop is never below entry + minProfitLockPoints
    let effectiveStopPrice: number;
    if (activePosition.profitLocked) {
      const lockedProfitPoints = entryPrice * (lockedProfitPercent / 100);
      const minLockedStop = roundToTick(entryPrice + lockedProfitPoints);
      // Once profit is locked, activate trailing stop but never trail below locked profit or initial stop
      effectiveStopPrice = Math.max(trailingStopPrice, minLockedStop, initialStopPrice);
    } else {
      // Before profit lock is triggered, keep only the initial stop loss active (no trailing)
      effectiveStopPrice = initialStopPrice;
    }
    
    // Check if stop loss is breached
    if (currentLtp <= effectiveStopPrice && effectiveStopPrice > initialStopPrice) {
      const trailingPnL = ((currentLtp - avgPrice) / avgPrice) * 100;
      
      const stopType = activePosition.profitLocked ? 'TRAILING STOP (Profit Locked)' : 'TRAILING STOP LOSS';
      console.log(`\n📉 ${stopType} TRIGGERED!`);
      console.log(`   ${matchingPosition.tsym}`);
      console.log(`   Entry: ₹${avgPrice.toFixed(2)}, Highest: ₹${activePosition.highestPrice.toFixed(2)}`);
      console.log(`   Current: ₹${currentLtp.toFixed(2)}, Trailing Stop: ₹${effectiveStopPrice.toFixed(2)}`);
      console.log(`   Profit Locked: +${trailingPnL.toFixed(2)}%`);
      
      // Cancel all pending orders
      console.log('📋 Fetching fresh order book to cancel all pending orders...');
      const freshOrderBookForTrailing: any = await getOrderBook();
      
      if (freshOrderBookForTrailing && Array.isArray(freshOrderBookForTrailing)) {
        const pendingOrders = freshOrderBookForTrailing.filter((order: any) => 
          order.tsym === matchingPosition.tsym &&
          (order.status === 'PENDING' || order.status === 'OPEN' || order.status === 'TRIGGER_PENDING')
        );

        if (pendingOrders.length > 0) {
          console.log(`   Cancelling ${pendingOrders.length} pending order(s)...`);
        }

        for (const order of pendingOrders) {
          try {
            console.log(`   Cancelling order: ${order.norenordno}`);
            await cancelOrder({ norenordno: String(order.norenordno) } as any);
            console.log(`   ✅ Cancelled`);
          } catch (err) {
            console.error(`   ❌ Error cancelling order:`, err);
          }
        }
      }

      // Exit position at market price
      console.log(`📝 Exiting position to lock in profit...`);
      const trailingSquareOffPayload = {
        exch: matchingPosition.exch,
        tsym: matchingPosition.tsym,
        qty: String(netQty),
        prc: '0',
        trantype: 'S',
        prctyp: 'MKT',
        prd: 'M',
        ret: 'DAY'
      };

      try {
        const trailingSquareOffRes = await placeOrder(trailingSquareOffPayload as any);
        if (trailingSquareOffRes?.stat === 'Ok') {
          console.log(`✅ Trailing Stop Exit Order Placed - Order ID: ${trailingSquareOffRes.norenordno}`);
          console.log(`   Profit Booked: +${trailingPnL.toFixed(2)}%\n`);
          return null;
        } else {
          console.error(`❌ Trailing Stop Exit Failed: ${trailingSquareOffRes?.emsg || 'Unknown error'}`);
          return activePosition;
        }
      } catch (err) {
        console.error(`❌ Error exiting position:`, err);
        return activePosition;
      }
    }

    return activePosition;
  } catch (err) {
    console.error('Error monitoring position:', err);
    return activePosition;
  }
}
