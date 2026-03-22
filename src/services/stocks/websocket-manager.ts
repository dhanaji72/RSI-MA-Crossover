import WebSocket from 'ws';
import { updateHybridCandleFromShoonyaLTP } from './instrument-updater';
import { getCurrentInterval } from './candle-config';

// ==================== WebSocket State ====================
let shoonyaWs: WebSocket | null = null;
let shoonyaSessionToken: string | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;

// ==================== Get Shoonya Session Token ====================
async function getShoonyaSessionToken(): Promise<string> {
  const { rest_authenticate } = await import('../utils/auth');
  
  const config = {
    id: process.env.ID || "",
    password: process.env.PASSWORD || "",
    api_key: process.env.API_KEY || "",
    vendor_key: process.env.VENDOR_KEY || "",
    imei: process.env.IMEI || "",
    topt: process.env.TOTP || "",
  };
  
  const sessionToken = await rest_authenticate(config);
  
  if (!sessionToken) {
    throw new Error('Shoonya session token not available. Please authenticate first.');
  }
  return sessionToken;
}

// ==================== Connect to Shoonya WebSocket ====================
export function connectShoonyaWebSocket(exchange: string, token: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    getShoonyaSessionToken().then(sessionToken => {
      shoonyaSessionToken = sessionToken;
      
      const wsUrl = 'wss://api.shoonya.com/NorenWSTP/';
      console.log(`🔌 Connecting to Shoonya WebSocket: ${wsUrl}`);
      
      shoonyaWs = new WebSocket(wsUrl);
      
      shoonyaWs.on('open', () => {
        console.log('✅ Shoonya WebSocket connected');
        
        // Send connection message
        const connectMsg = {
          t: 'c',
          uid: process.env.ID || '',
          actid: process.env.ID || '',
          susertoken: sessionToken,
          source: 'API'
        };
        shoonyaWs?.send(JSON.stringify(connectMsg));
        
        // Start heartbeat to keep connection alive
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        heartbeatInterval = setInterval(() => {
          if (shoonyaWs && shoonyaWs.readyState === WebSocket.OPEN) {
            const pingMsg = { t: 'h' };
            shoonyaWs.send(JSON.stringify(pingMsg));
            // Heartbeat sent silently
          }
        }, 5000); // Send heartbeat every 5 seconds
      });
      
      shoonyaWs.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          
          // Handle connection acknowledgment
          if (message.t === 'ck') {
            console.log('✅ Shoonya WebSocket connection acknowledged');
            // Subscribe to NIFTY 50 after connection is acknowledged
            setTimeout(() => {
              const subscribeMsg = {
                t: 't',
                k: `${exchange}|${token}` // e.g., NSE|26000 for NIFTY 50
              };
              console.log(`📡 Subscribing to NIFTY 50 LTP: ${subscribeMsg.k}`);
              shoonyaWs?.send(JSON.stringify(subscribeMsg));
              resolve();
            }, 500);
          }
          
          // Handle subscription acknowledgment
          if (message.t === 'tk' && message.s === 'OK') {
            console.log('✅ NIFTY 50 subscription confirmed');
          }
          
          // Handle tick data
          if (message.t === 'tk' || message.t === 'tf') {
            const ltp = parseFloat(message.lp || message.c || 0);
            if (ltp > 0) {
              // Update hybrid candle with new LTP using current interval
              const currentInterval = getCurrentInterval();
              updateHybridCandleFromShoonyaLTP(ltp, currentInterval);
            }
          }
        } catch (err) {
          console.error('❌ Error parsing WebSocket message:', err);
        }
      });
      
      shoonyaWs.on('error', (err) => {
        console.error('❌ Shoonya WebSocket error:', err);
        reject(err);
      });
      
      shoonyaWs.on('close', () => {
        console.log('🔌 Shoonya WebSocket disconnected. Reconnecting in 5s...');
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        setTimeout(() => connectShoonyaWebSocket(exchange, token), 5000);
      });
    }).catch(reject);
  });
}

// ==================== Disconnect WebSocket ====================
export function disconnectShoonyaWebSocket(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (shoonyaWs) {
    shoonyaWs.close();
    shoonyaWs = null;
  }
}

// ==================== Get WebSocket State ====================
export function isWebSocketConnected(): boolean {
  return shoonyaWs !== null && shoonyaWs.readyState === WebSocket.OPEN;
}
