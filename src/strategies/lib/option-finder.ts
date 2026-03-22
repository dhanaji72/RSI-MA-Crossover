import * as fs from 'fs';
import * as path from 'path';
import { getQuotes } from '../../services/stocks/stocklist';

interface OptionInfo {
  instrument: any;
  ltp: number;
}

interface InstrumentData {
  Exchange: string;
  Token: string;
  LotSize: string;
  Symbol: string;
  TradingSymbol: string;
  Expiry: string;
  Instrument: string;
  OptionType: string;
  StrikePrice: string;
  TickSize: string;
}

/**
 * Find an option (CE/PE) near the target premium price
 * @param optionType 'CE' or 'PE'
 * @param targetPremium Target premium price (e.g., 120)
 * @returns Option instrument with LTP, or null if not found
 */
export async function findOptionNearPremium(
  optionType: 'CE' | 'PE',
  targetPremium: number
): Promise<OptionInfo | null> {
  try {
    // Load merged instruments
    const instrumentsPath = path.join(__dirname, '../../merged_instruments.json');
    const instrumentsData = JSON.parse(fs.readFileSync(instrumentsPath, 'utf-8'));
    const nfoInstruments: InstrumentData[] = instrumentsData.NFO || [];

    // Check if today is Tuesday (1 = Monday, 2 = Tuesday, etc.)
    const today = new Date();
    const dayOfWeek = today.getDay();
    const isTuesday = dayOfWeek === 2;

    // Get all NIFTY options of the specified type
    let options = nfoInstruments.filter(
      (inst) =>
        inst.Symbol === 'NIFTY' &&
        inst.Instrument === 'OPTIDX' &&
        inst.OptionType === optionType
    );

    if (options.length === 0) {
      console.warn(`No ${optionType} options found in instruments file`);
      return null;
    }

    // If Tuesday, filter for next week's expiry
    if (isTuesday) {
      // Get all unique expiry dates and sort them
      const expiryDates = [...new Set(options.map(opt => opt.Expiry))].sort();
      
      if (expiryDates.length >= 2) {
        // Use the second nearest expiry (skip current week's expiry)
        const nextExpiry = expiryDates[1];
        options = options.filter(opt => opt.Expiry === nextExpiry);
        console.log(`📅 Tuesday detected - Using next week's expiry: ${nextExpiry}`);
      } else {
        console.warn(`⚠️  Tuesday but only one expiry available, using it`);
      }
    } else {
      // Use nearest expiry for other days
      const expiryDates = [...new Set(options.map(opt => opt.Expiry))].sort();
      if (expiryDates.length > 0) {
        const nearestExpiry = expiryDates[0];
        options = options.filter(opt => opt.Expiry === nearestExpiry);
      }
    }

    if (options.length === 0) {
      console.warn(`No ${optionType} options found after expiry filtering`);
      return null;
    }

    // Get LTP for each option and find closest to target premium
    let closestOption: OptionInfo | null = null;
    let closestDiff = Infinity;

    for (const option of options) {
      try {
        const quote = await getQuotes({
          exch: option.Exchange,
          token: option.Token
        });

        if (quote?.stat === 'Ok' && quote.lp) {
          const ltp = parseFloat(quote.lp);
          const diff = Math.abs(ltp - targetPremium);

          if (diff < closestDiff) {
            closestDiff = diff;
            closestOption = {
              instrument: option,
              ltp: ltp
            };
          }
        }
      } catch (err) {
        // Skip this option if quote fetch fails
        continue;
      }
    }

    if (closestOption) {
      console.log(
        `Found ${optionType} option: ${closestOption.instrument.TradingSymbol} at ₹${closestOption.ltp.toFixed(2)} (target: ₹${targetPremium})`
      );
    } else {
      console.warn(`No ${optionType} option found with valid LTP`);
    }

    return closestOption;
  } catch (err) {
    console.error(`Error finding ${optionType} option:`, err);
    return null;
  }
}
