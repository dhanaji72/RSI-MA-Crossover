import Config from "../config/config";
import axios from "axios";
import { rest_authenticate } from "../utils/auth";
import { DateTime } from 'luxon';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';


const conf = new Config();

interface AuthConfig {
  id: string;
  password: string;
  api_key: string;
  vendor_key: string;
  imei: string;
  topt: string;
}

interface StockListParams {
  query: string;
  exchange: string;
  instrumentType?: string; // FUTIDX, OPTIDX, etc.
  optionType?: string; // CE, PE
  expiryMonth?: string; // May, Jun, etc.
  expiryYear?: string; // 2025, etc.
  weeklyOnly?: boolean; // Restrict to weekly expiries (Tuesday) within ~10 days
  exactExpiry?: string; // e.g., '16-DEC-2025' to target a specific expiry date
}

interface StockListResponse {
  stat: string;
  values?: any[];
  total?: number;
  limit?: number;
  offset?: number;
  request_time?: string;
  emsg?: string;
  expiryDates?: string[]; // Available expiry dates
  expiryMonths?: string[]; // Available expiry months
  availableStrikes?: number[]; // <-- Add this line
  status?: string;
  message?: string;
}

// IST helpers
function nowIST(): DateTime { return DateTime.now().setZone('Asia/Kolkata'); }
function parseExpiryIST(raw: string): DateTime | null {
  if (!raw) return null;
  // Try common formats from Shoonya like '23-DEC-2025'
  let dt = DateTime.fromFormat(raw.trim(), 'dd-LLL-yyyy', { zone: 'Asia/Kolkata', locale: 'en' });
  if (!dt.isValid) {
    // Try ISO or JS Date parse fallback in IST
    const tryIso = DateTime.fromISO(raw, { zone: 'Asia/Kolkata' });
    if (tryIso.isValid) dt = tryIso;
  }
  return dt.isValid ? dt : null;
}
function isTuesdayIST(dt: DateTime): boolean { return dt.setZone('Asia/Kolkata').weekday === 2; }
function toISODateIST(dt: DateTime): string { return dt.setZone('Asia/Kolkata').toISODate()!; }

// Helper: fetch weekly NIFTY instruments with fallback to next week
export async function getWeeklyWithFallback(params: {
  query: string;
  exchange: string;
  optionType?: string;
}): Promise<StockListResponse> {
  const { query, exchange, optionType } = params;
  const base = nowIST().startOf('day');
  const tuesdays: DateTime[] = [];
  for (let i = 1; i <= 14 && tuesdays.length < 2; i++) {
    const d = base.plus({ days: i });
    if (d.weekday === 2) tuesdays.push(d);
  }
  const fmt = (d: DateTime) => d.toFormat('dd-LLL-yyyy').toUpperCase();

  // Try current Tuesday first
  const currentExpiry = tuesdays[0] ? fmt(tuesdays[0]) : undefined;
  if (currentExpiry) {
    const res = await getStockList({ query, exchange, optionType, exactExpiry: currentExpiry, limit: 500 });
    if (res.stat === 'Ok' && Array.isArray(res.values) && res.values.length > 0) return res;
  }
  // Fallback to next Tuesday
  const nextExpiry = tuesdays[1] ? fmt(tuesdays[1]) : undefined;
  if (nextExpiry) {
    const res = await getStockList({ query, exchange, optionType, exactExpiry: nextExpiry, limit: 500 });
    if (res.stat === 'Ok' && Array.isArray(res.values) && res.values.length > 0) return res;
  }
  // Final fallback: weeklyOnly filter (within 10 days)
  return getStockList({ query, exchange, optionType, weeklyOnly: true, limit: 500 });
}

const getStockList = async ({
  query,
  exchange,
  instrumentType,
  optionType,
  expiryMonth,
  expiryYear,
  weeklyOnly,
  exactExpiry,
  strikePrice,
  minStrike,
  maxStrike,
  limit = 100,
  offset = 0
}: StockListParams & { 
  limit?: number; 
  offset?: number;
  strikePrice?: number;
  minStrike?: number;
  maxStrike?: number;
}): Promise<StockListResponse> => {
  const config: AuthConfig = {
    id: process.env.ID || "",
    password: process.env.PASSWORD || "",
    api_key: process.env.API_KEY || "",
    vendor_key: process.env.VENDOR_KEY || "",
    imei: process.env.IMEI || "",
    topt: process.env.TOTP || "",
  };

  try {
    // Only use local file if both exchange is NFO and query includes BANKNIFTY
    const useLocalFile = exchange.toUpperCase() === 'NFO' || 
                         query.toUpperCase().includes('BANKNIFTY');
    
    let localFileProcessed = false;
    
    if (useLocalFile) {
      try {
        const filePath = path.resolve(__dirname, '../../merged_instruments.json');
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(fileContent);

        const normalizedQuery = query.toUpperCase().trim();
        const exchangeInstruments = data['NFO'] || [];

        // Filter instruments
        let filteredResults = exchangeInstruments.filter((instrument: any) => {
          // First check if it contains BANKNIFTY
          const matchesQuery = 
            (instrument.Symbol && instrument.Symbol.toUpperCase().includes(normalizedQuery)) ||
            (instrument.TradingSymbol && instrument.TradingSymbol.toUpperCase().includes(normalizedQuery));
            
          if (!matchesQuery) return false;
          
          // Filter by option type
          if (optionType && instrument.OptionType !== optionType) {
            return false;
          }

          // Filter by expiry month
          if (expiryMonth) {
            if (!instrument.Expiry) return false;
            
            const expiryDate = new Date(instrument.Expiry);
            if (isNaN(expiryDate.getTime())) return false;
            
            const monthName = expiryDate.toLocaleString('default', { month: 'short' });
            if (normalizeMonthName(monthName) !== normalizeMonthName(expiryMonth)) {
              return false;
            }
          }

          // Filter by expiry year
          if (expiryYear) {
            if (!instrument.Expiry) return false;
            
            const expiryDate = new Date(instrument.Expiry);
            if (isNaN(expiryDate.getTime())) return false;
            
            const year = expiryDate.getFullYear().toString();
            if (year !== expiryYear) {
              return false;
            }
          }
          
          // Filter by exact strike price if provided
          if (strikePrice !== undefined) {
            const instrumentStrike = parseFloat(instrument.StrikePrice);
            if (isNaN(instrumentStrike) || instrumentStrike !== strikePrice) {
              return false;
            }
          }
          
          // Filter by strike price range if provided
          if (minStrike !== undefined || maxStrike !== undefined) {
            const instrumentStrike = parseFloat(instrument.StrikePrice);
            if (isNaN(instrumentStrike)) return false;
            
            if (minStrike !== undefined && instrumentStrike < minStrike) {
              return false;
            }
            
            if (maxStrike !== undefined && instrumentStrike > maxStrike) {
              return false;
            }
          }

          // Weekly-only filter: Tuesday expiry within next 10 days (IST)
          if (weeklyOnly) {
            const ex = instrument.Expiry || instrument.expiry || instrument.ExpiryDate;
            if (!ex) return false;
            const dt = parseExpiryIST(ex);
            if (!dt) return false;
            if (!isTuesdayIST(dt)) return false;
            const today = nowIST().startOf('day');
            const expiry = dt.startOf('day');
            const diffDays = expiry.diff(today, 'days').days;
            if (!(diffDays > 0 && diffDays <= 10)) return false;
          }

          // Exact expiry date filter if provided (supports formats like '16-DEC-2025') using IST
          if (exactExpiry) {
            const ex = instrument.Expiry || instrument.expiry || instrument.ExpiryDate;
            if (!ex) return false;
            const norm = (s: string) => {
              const p = parseExpiryIST(s);
              return p ? p.toFormat('dd-LLL-yyyy').toUpperCase() : s.toUpperCase().replace(/\s+/g, '-');
            };
            if (norm(ex) !== norm(exactExpiry)) return false;
          }
          return true;
        });
        
        // Collect expiry dates for filtered results
        let allExpiryDates = new Set<string>();
        let allExpiryMonths = new Set<string>();
        let allStrikePrices = new Set<number>();

        filteredResults.forEach((instrument: any) => {
          if (instrument.Expiry) {
            const expiryDate = new Date(instrument.Expiry);
            if (!isNaN(expiryDate.getTime())) {
              // Store full expiry date
              allExpiryDates.add(instrument.Expiry);
              
              // Store month-year format
              const month = expiryDate.toLocaleString('default', { month: 'short' });
              const year = expiryDate.getFullYear();
              allExpiryMonths.add(`${month}-${year}`);
            }
          }
          
          // Collect available strike prices
          if (instrument.StrikePrice) {
            const strike = parseFloat(instrument.StrikePrice);
            if (!isNaN(strike)) {
              allStrikePrices.add(strike);
            }
          }
        });

        // Convert Sets to sorted arrays
        const expiryDatesArray = Array.from(allExpiryDates)
          .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
        
        const expiryMonthsArray = Array.from(allExpiryMonths)
          .sort((a, b) => {
            const [monthA, yearA] = a.split('-');
            const [monthB, yearB] = b.split('-');
            const dateA = new Date(`${monthA} 1, ${yearA}`);
            const dateB = new Date(`${monthB} 1, ${yearB}`);
            return dateA.getTime() - dateB.getTime();
          });
          
        const strikePricesArray = Array.from(allStrikePrices).sort((a, b) => a - b);

        if (filteredResults.length > 0) {
          const slicedResults = filteredResults.slice(offset, offset + limit);
          localFileProcessed = true;
          return {
            stat: "Ok",
            values: slicedResults,
            total: filteredResults.length,
            limit,
            offset,
            expiryDates: expiryDatesArray,
            expiryMonths: expiryMonthsArray,
            availableStrikes: strikePricesArray,
            request_time: new Date().toISOString()
          };
        }
        else {
          console.log("No results found in local file, falling back to API.");
        }
      } catch (fileError) {
        console.log("Error accessing local file, falling back to API:");
        // Continue to API call instead of exiting
      }
    }
    
    // If not using local file or no results found, go to API
    console.log("Proceeding with API call");
    const token = await rest_authenticate(config);
    if (token.length === 0) {
      return { stat: "Not_Ok", emsg: "Token generation issue" };
    }

    const values: Record<string, string> = {
      uid: config.id,
      stext: query,
      exch: exchange,
    };

    let payload = "jData=" + JSON.stringify(values) + `&jKey=${token}`;
    const stockListResponse = await axios.post(conf.StockList_URL, payload);

    if (stockListResponse.data["stat"] === "Ok") {
      let data = stockListResponse.data;
      // Apply weekly-only client-side filter if requested (IST)
      if (weeklyOnly && Array.isArray(data.values)) {
        const today = nowIST().startOf('day');
        const filtered = data.values.filter((instrument: any) => {
          const ex = instrument.Expiry || instrument.expiry || instrument.ExpiryDate;
          if (!ex) return false;
          const dt = parseExpiryIST(ex);
          if (!dt) return false;
          if (!isTuesdayIST(dt)) return false;
          const diffDays = dt.startOf('day').diff(today, 'days').days;
          return diffDays > 0 && diffDays <= 10;
        });
        data = { ...data, values: filtered };
      }

      // Apply exact expiry client-side filter if requested (IST)
      if (exactExpiry && Array.isArray(data.values)) {
        const normalize = (s: string) => {
          const p = parseExpiryIST(s);
          return p ? p.toFormat('dd-LLL-yyyy').toUpperCase() : s.toUpperCase().replace(/\s+/g, '-');
        };
        const target = normalize(exactExpiry);
        const filtered = data.values.filter((instrument: any) => {
          const ex = instrument.Expiry || instrument.expiry || instrument.ExpiryDate;
          if (!ex) return false;
          return normalize(ex) === target;
        });
        data = { ...data, values: filtered };
      }
      return data;
    } else {
      return stockListResponse.data;
    }
  } catch (error: any) {
    console.error("Search error:", error);
    return {
      stat: "Not_Ok",
      emsg: `Search error: ${error.message}`,
      request_time: new Date().toISOString()
    };
  }
};
function normalizeMonthName(monthStr: string): string {
  // Convert to lowercase and remove periods
  const normalizedMonth = monthStr.toLowerCase().replace(/\./g, '');
  
  // Map of common month variations to standard 3-letter abbreviations
  const monthMappings: Record<string, string> = {
    'jan': 'jan', 'january': 'jan',
    'feb': 'feb', 'february': 'feb',
    'mar': 'mar', 'march': 'mar',
    'apr': 'apr', 'april': 'apr',
    'may': 'may',
    'jun': 'jun', 'june': 'jun',
    'jul': 'jul', 'july': 'jul',
    'aug': 'aug', 'august': 'aug',
    'sep': 'sep', 'sept': 'sep', 'september': 'sep',
    'oct': 'oct', 'october': 'oct',
    'nov': 'nov', 'november': 'nov',
    'dec': 'dec', 'december': 'dec'
  };
  
  // Try to map to standard format, or return original if no mapping found
  return monthMappings[normalizedMonth] || normalizedMonth;
}
interface QuotesParams {
  exch: string;
  token: string;
}

interface QuotesResponse {
  [key: string]: any;
}

const getQuotes = async (params: QuotesParams): Promise<QuotesResponse> => {
  const config: AuthConfig = {
    id: process.env.ID || "",
    password: process.env.PASSWORD || "",
    api_key: process.env.API_KEY || "",
    vendor_key: process.env.VENDOR_KEY || "",
    imei: process.env.IMEI || "",
    topt: process.env.TOTP || "",
  };

  console.log('getQuotes function called with params:', params);

  // Function to make the actual request
  const makeRequest = async (authToken: string): Promise<QuotesResponse> => {

    const values: Record<string, string> = {
      uid: config.id
    };

    if (params.exch) values.exch = params.exch;
    if (params.token) values.token = params.token;

    let payload = 'jData=' + JSON.stringify(values);
    payload = payload + `&jKey=${authToken}`;

    console.log('Getting quotes with payload (sensitive data masked):', {
      ...values,
      // Not showing the token for security
    });

    try {
      const quotesResponse = await axios.post(conf.GET_QUOTES_URL, payload);
      console.log('Quotes response status:', quotesResponse.status);

      // Handle empty 200 responses or unexpected payload shapes
      if (!quotesResponse.data || (typeof quotesResponse.data === 'object' && Object.keys(quotesResponse.data).length === 0)) {
        console.warn('Quotes API returned 200 but empty body');
        return { stat: 'Not_Ok', message: 'Empty response body' };
      }

      // Normalize common response shapes into an easy-to-use object
      const d: any = quotesResponse.data;
      // sometimes the real payload is nested under properties like 'data' or 'values'
      const payloadCandidate = d.data ?? d.values ?? d.result ?? d;

      // If API signals error inside a 200 payload
      if (payloadCandidate && (payloadCandidate.stat === 'Not_Ok' || payloadCandidate.stat === 'Not_Ok' || payloadCandidate.message || payloadCandidate.emsg)) {
        // Return original payload so callers can inspect emsg/message
        return payloadCandidate;
      }

      // If the provider returns an array or object with price keys, return it unchanged but add normalized fields
      const normalized: any = Array.isArray(payloadCandidate) ? payloadCandidate[0] ?? {} : { ...payloadCandidate };

      // common mappings
      normalized.ltp = normalized.ltp ?? normalized.LTP ?? normalized.last_price ?? normalized.lastPrice ?? normalized.last ?? normalized.lp ?? normalized.lastTradedPrice ?? normalized.LastTradedPrice;
      normalized.volume = normalized.volume ?? normalized.Volume ?? normalized.v ?? normalized.vol ?? normalized.totalVolume;

      return normalized;
    } catch (error: any) {
      console.error('Error in API request:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
        return error.response.data || {
          stat: "Not_Ok",
          message: error.message,
          error: "API request failed"
        };
      }
      throw error;
    }
  };

  try {
    // First attempt with initial authentication
    console.log('Authenticating...');
    let token = await rest_authenticate(config);

    if (!token || token.length === 0) {
      console.error('Authentication failed: Empty token');
      return {
        stat: "Not_Ok",
        message: "Authentication failed: Unable to generate token"
      };
    }

    console.log('Authentication successful, token length:', token.length);

    // First attempt with a few retries in case API returns empty 200 or transient errors
    const maxAttempts = 3;
    let attempt = 0;
    let response: any = null;
    while (attempt < maxAttempts) {
      attempt += 1;
      response = await makeRequest(token);
      // Accept a response that has price info or is explicitly Ok
      if (response && (response.ltp !== undefined || response.LTP !== undefined || response.stat === 'Ok')) {
        return response;
      }
      console.warn(`Quotes attempt ${attempt} did not return usable data, retrying...`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }

    // Return the last response (likely an error payload) for callers to inspect
    return response;

  } catch (error: any) {
    console.error('Error getting quotes:', error);
    return {
      stat: "Not_Ok",
      message: `Error fetching quotes: ${error.message}`,
      error: error.response ? error.response.data : null
    };
  }
};


export { getStockList, getQuotes, getWeeklyWithFallback };