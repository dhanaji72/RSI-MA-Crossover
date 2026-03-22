import { placeOrder, cancelOrder, getPositions, getOrderBook } from '../../services/orders/order';
import { MORNING_STRATEGY_CONFIG } from '../config/morning-strategy-config';

/**
 * Square off ALL positions and cancel ALL orders from Shoonya API at end of day
 * Fetches fresh data from API, not relying on tracked positions
 */
export async function squareOffAllPositionsAndOrders(): Promise<void> {
  console.log('\n🔄 Closing all positions and orders...');
  
  try {
    // 1. Get all pending orders
    const orderBookResponse: any = await getOrderBook();
    
    if (orderBookResponse && Array.isArray(orderBookResponse)) {
      const pendingOrders = orderBookResponse.filter((order: any) => 
        order.status === 'PENDING' || order.status === 'OPEN' || order.status === 'TRIGGER_PENDING'
      );
      
      if (pendingOrders.length > 0) {
        console.log(`\n📋 Cancelling ${pendingOrders.length} pending order(s)...`);
      }
      
      // Cancel all pending orders
      for (const order of pendingOrders) {
        try {
          await cancelOrder({ norenordno: String(order.norenordno) } as any);
          console.log(`   ✅ ${order.tsym} - Cancelled`);
        } catch (err) {
          console.error(`   ❌ Failed to cancel order:`, err);
        }
      }
    }
    
    // 2. Get all open positions
    const positionsResponse: any = await getPositions();
    
    if (positionsResponse && Array.isArray(positionsResponse)) {
      const openPositions = positionsResponse.filter((pos: any) => {
        const netQty = parseInt(pos.netqty || '0');
        return netQty !== 0 && pos.prd === 'M'; // Only NRML positions
      });
      
      if (openPositions.length > 0) {
        console.log(`\n📊 Closing ${openPositions.length} open position(s)...`);
      }
      
      // Square off all positions
      for (const pos of openPositions) {
        try {
          const netQty = Math.abs(parseInt(pos.netqty || '0'));
          const side = parseInt(pos.netqty) > 0 ? 'buy' : 'sell';
          const tsym = pos.tsym;
          const exch = pos.exch;
          
          // Place market order to square off
          const squareOffPayload = {
            exch,
            tsym,
            qty: String(netQty),
            prc: '0',
            trantype: side === 'buy' ? 'S' : 'B', // Opposite side
            prctyp: 'MKT',
            prd: 'M',
            ret: 'DAY'
          };
          
          await placeOrder(squareOffPayload as any);
          console.log(`   ✅ ${tsym} - Closed`);
        } catch (err) {
          console.error(`   ❌ Error closing position:`, err);
        }
      }
    }
    
    console.log('\n✅ All positions and orders closed\n');
  } catch (err) {
    console.error('❌ Error:', err);
    throw err;
  }
}

/**
 * Check if current time is at or past end-of-day cutoff (3:05 PM IST)
 */
export function isEndOfTradingDay(): boolean {
  const now = new Date();
  const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const currentHour = istTime.getHours();
  const currentMinute = istTime.getMinutes();
  
  const cleanupHour = MORNING_STRATEGY_CONFIG.CLEANUP_HOUR;
  const cleanupMinute = MORNING_STRATEGY_CONFIG.CLEANUP_MINUTE;
  
  return (currentHour === cleanupHour && currentMinute >= cleanupMinute) || currentHour > cleanupHour;
}

/**
 * Handle end-of-day procedures: square off all positions, cancel all orders, verify cleanup, and exit
 */
export async function handleEndOfDay(): Promise<void> {
  console.log('\n⏰ 3:05 PM REACHED - Squaring off ALL positions and cancelling ALL orders...');
  
  try {
    // Fetch and square off all positions/orders from Shoonya API
    await squareOffAllPositionsAndOrders();
    
    // Verify cleanup with API calls
    console.log('\n🔍 Verifying cleanup completion...');
    const finalPositions: any = await getPositions();
    const finalOrders: any = await getOrderBook();
    
    let cleanupSuccess = true;
    
    // Check positions
    if (finalPositions && Array.isArray(finalPositions)) {
      const remainingPos = finalPositions.filter((pos: any) => {
        const netQty = parseInt(pos.netqty || '0');
        return netQty !== 0 && pos.prd === 'M';
      });
      
      if (remainingPos.length > 0) {
        console.log(`❌ WARNING: ${remainingPos.length} position(s) still open!`);
        remainingPos.forEach((pos: any) => console.log(`   - ${pos.tsym}: ${pos.netqty}`));
        cleanupSuccess = false;
      } else {
        console.log('✅ All positions closed');
      }
    }
    
    // Check orders
    if (finalOrders && Array.isArray(finalOrders)) {
      const remainingOrders = finalOrders.filter((order: any) => 
        order.status === 'PENDING' || order.status === 'OPEN' || order.status === 'TRIGGER_PENDING'
      );
      
      if (remainingOrders.length > 0) {
        console.log(`❌ WARNING: ${remainingOrders.length} order(s) still pending!`);
        remainingOrders.forEach((ord: any) => console.log(`   - ${ord.tsym}: ${ord.status}`));
        cleanupSuccess = false;
      } else {
        console.log('✅ All orders cancelled');
      }
    }
    
    if (cleanupSuccess) {
      console.log('\n✅ Cleanup verified successfully - All positions and orders closed');
    } else {
      console.log('\n⚠️  Cleanup incomplete - Please check manually');
    }
  } catch (err) {
    console.error('❌ Error:', err);
  }
  
  // Stop program after square-off
  console.log('🛑 Trading day ended - Program stopped\n');
  process.exit(0);
}
