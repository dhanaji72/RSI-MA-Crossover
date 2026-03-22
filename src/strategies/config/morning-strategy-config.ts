// ==================== Morning Trading Strategy Configuration ====================

export const MORNING_STRATEGY_CONFIG = {
  // Candle Formation Timing
  CANDLE_START_HOUR: 9,
  CANDLE_START_MINUTE: 15,
  
  // Overall strategy window (for process start/stop guards)
  START_HOUR: 9,      // 9:15 AM window start
  START_MINUTE: 15,
  END_HOUR: 14,       // 2:50 PM window end
  END_MINUTE: 50,
  
  // Single trading session: 9:25 AM - 2:50 PM, exit at 3:05 PM if target/stop not hit
  SESSION_START_HOUR: 9,
  SESSION_START_MINUTE: 25,
  SESSION_END_HOUR: 14,
  SESSION_END_MINUTE: 50,
  SESSION_EXIT_HOUR: 15,
  SESSION_EXIT_MINUTE: 5,

  // Pre-market restart time (for npm start / PM2 restarts)
  PREMARKET_RESTART_HOUR: 22,
  PREMARKET_RESTART_MINUTE: 45,
  
  // End of Day Cleanup
  CLEANUP_HOUR: 15,
  CLEANUP_MINUTE: 5,
  
  // Indicator Settings
  RSI_LENGTH: 14,
  RSI_EMA_LENGTH: 21,
  ADX_LENGTH: 14,
  ADX_MIN_THRESHOLD: 18, // Minimum ADX value required for entry (trend strength filter)
  INTERVAL_MINUTES: 5, // 5-minute candles for morning strategy
  
  // NIFTY 50 Index Settings
  NIFTY_TOKEN: '26000',
  NIFTY_EXCHANGE: 'NSE',
  SYMBOL: 'NIFTY',
  EXCHANGE: 'NFO',
  SEARCH_QUERY: 'NIFTY',
  
  // Option Selection
  TARGET_PREMIUM: 100,
  ATM_RANGE: 10, // Number of strike steps around ATM to keep in merged_instruments
  
  // Risk Management - Percentage-based
  TARGET_PERCENT: 50, // +50% profit target
  STOP_PERCENT: 15, // -15% stop loss
  TRAILING_STOP_PERCENT: 15, // Trailing stop at (highest price - 15% of entry price)
  MIN_PROFIT_LOCK_PERCENT: 10, // % move from entry required before profit lock starts
  LOCKED_PROFIT_PERCENT: 5, // % of entry price to lock once profit lock triggers
  EXISTING_TARGET_PERCENT: 50, // For existing positions
  EXISTING_STOP_PERCENT: 15, // For existing positions
  
  // Momentum Fading Check
  MOMENTUM_CHECK_PERCENT: 10, // Required profit % within time window
  MOMENTUM_CHECK_MINUTES: 30, // Time window in minutes (6 candles at 5-min interval)
  
  // Strategy Timing
  LOOP_INTERVAL_MS: 2000, // Check every 2 seconds
  
  // Candle Requirements
  REQUIRED_CANDLES_BUFFER: 55, // Extra candles for smooth indicator calculation
  
  // Signal Thresholds
  RSI_OVERSOLD: 40,
  RSI_OVERBOUGHT: 65,
  RSI_BEARISH_THRESHOLD: 40,
  
  // RSI-EMA Difference Check
  MIN_RSI_EMA_DIFF: 2, // Minimum difference between RSI and RSI-EMA for signal validation
} as const;

export type MorningStrategyConfig = typeof MORNING_STRATEGY_CONFIG;
