/**
 * Global candle interval configuration
 * Used by WebSocket to determine candle building interval
 */
let currentIntervalMinutes = 5; // Default to 5 minutes
let candleStartHour = 9; // Default start hour (9:45 AM for main strategy)
let candleStartMinute = 45; // Default start minute

export const INTERVAL_MINUTES = 5; // Default candle interval constant

export function setCurrentInterval(minutes: number): void {
  currentIntervalMinutes = minutes;
  console.log(`📊 Candle interval updated to ${minutes} minutes`);
}

export function getCurrentInterval(): number {
  return currentIntervalMinutes;
}

export function setCandleStartTime(hour: number, minute: number): void {
  candleStartHour = hour;
  candleStartMinute = minute;
  console.log(`📊 Candle start time updated to ${hour}:${minute.toString().padStart(2, '0')}`);
}

export function getCandleStartTime(): { hour: number; minute: number } {
  return { hour: candleStartHour, minute: candleStartMinute };
}
