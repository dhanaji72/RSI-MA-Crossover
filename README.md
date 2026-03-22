# Finvasia MCP Server

A Node.js-based server that connects to **Finvasia's Market Connect Protocol (MCP)** to enable seamless interaction with the Finvasia trading platform. This server acts as a bridge between Finvasia’s API and your trading application or frontend dashboard.

![](https://github.com/HexaMCP/Finvasia/blob/main/main.gif)


## 📌 Current Features

- 👤 Fetch **User Profile Data**
- 💰 Fetch **Account Balance**
- 🟢 **Buy Orders**
- 🔴 **Sell Orders**
- ❌ **Cancel Orders**
- ✏️ **Modify Orders**
- 📈 **Current Stock Prices**
- 📊 **Positions**
- 💼 **Holdings**
- 💸 **Order Margin**
- 📚 **Order Book**
- 📒 **Trade Book**
- 🎯 **Take Profit** Orders
- 🛑 **Stop Loss** Orders
- 🧠 **Options Buy & Sell**

More features and modules will be added progressively.

## 📊 **NIFTY 50 RSI/EMA Trading Strategy**

This repository includes a fully automated NIFTY 50 index trading strategy that uses technical indicators (RSI and RSI-EMA) to generate trading signals for options trading on the NFO exchange.

### **Strategy Overview**

The strategy monitors NIFTY 50 index in real-time using 5-minute candles and executes trades based on RSI (Relative Strength Index) and its EMA crossovers.

- **Goal:** Trade NIFTY options (NFO) when RSI crosses its smoothed EMA on 5-minute candles.

- **Indicators:** RSI length = 14, RSI_EMA length = 21 (Wilder smoothing for RSI; standard EMA for RSI_EMA).

- **Data source:** Yahoo Finance via the `yahoo-finance2` package (wrapped in `src/services/stocks/yahoo.ts`).

- **Exchange / instruments:** Strategy focuses on NIFTY options on the NFO exchange and only considers the nearest/current expiry option strikes.

- **Order logic:** On a bullish cross (RSI crosses above RSI_EMA) the bot places a CE buy order; on a bearish cross (RSI crosses below RSI_EMA) it places a PE buy order. It selects an option whose LTP is close to the configured premium (default: ₹90) and places target & stop orders.

- **Target/Stop:** Target profit = +50% from entry; Stop loss = -20% from entry; Trailing stop = -15% from entry (configurable in `src/strategies/config/morning-strategy-config.ts`).

- **Exit handling:** Positions exit only when target (+50%), stop loss (-20%), trailing stop (-15%), momentum fading (+15% in 20min), or session time limits are hit. Opposite signals do NOT trigger exits - positions are held until risk management rules activate.


**Key files & modules**
- `src/strategies/morning-strategy.ts`: Main dual-session strategy (Session 1: 9:25-11:00 AM, Session 2: 12:30-2:00 PM), 5-minute candles, RSI/EMA signals with ADX filter. [See file](src/strategies/morning-strategy.ts)
- `src/strategies/config/morning-strategy-config.ts`: Strategy configuration (session times, RSI/EMA/ADX parameters, risk management settings). [See file](src/strategies/config/morning-strategy-config.ts)
- `src/strategies/lib/indicators.ts`: Implements the Wilder RSI, EMA, and ADX calculation used by the strategy. [See file](src/strategies/lib/indicators.ts)
- `src/services/stocks/stocklist.ts`: Option chain and quotes lookup used to find option instruments (restricted to `NFO` exchange & `NIFTY` instruments). [See file](src/services/stocks/stocklist.ts)
- `src/strategies/lib/order-handler.ts`: Contains order placement and position management helpers using Shoonya order APIs. [See file](src/strategies/lib/order-handler.ts)
- `src/strategies/lib/position-monitor.ts`: Monitors positions for target, stop loss, trailing stop, momentum fading, and session time exits. [See file](src/strategies/lib/position-monitor.ts)
- `src/strategies/scenarios/bullish.ts` and `src/strategies/scenarios/bearish.ts`: Encapsulate strategy behavior for bullish/bearish entry logic. [See files](src/strategies/scenarios/bullish.ts) [See file](src/strategies/scenarios/bearish.ts)

**Configuration & Environment**
- The strategy uses Shoonya (Finvasia) account credentials available via `.env` keys: `ID`, `PASSWORD`, `VENDOR_KEY`, `IMEI`, `API_KEY`, and `TOTP`. Add them to `.env` in the root of the workspace.
- Verify `merged_instruments.json` is available in the project (used for local option chains); otherwise `getStockList` will call MCP API.
- The constants used by the strategy (RSI length `RSI_LENGTH`, RSI_EMA length `RSI_EMA_LENGTH`, target premium `TARGET_PREMIUM`, exchange `EXCHANGE`) can be modified in `src/strategies/nifty-rsi-trader.ts`.

**Running the strategy**
1. Build the project and start the server (auto-starts the strategy when the MCP server begins):

```bash
npm run build
npm start
```

2. Or run the strategy directly (useful for quick debugging or dev):

```bash
npm run rsi:trade
```

**Yahoo NIFTY RSI Daemon**

There's a small tool that fetches NIFTY 5-minute bars from Yahoo Finance and prints RSI(14) and a 21-period EMA of the RSI at every 5-minute boundary:

- Script: `src/tools/yahoo_nifty_rsi_daemon.ts`
- Run: `npm run yahoo:nifty:rsi`
- Config: the daemon fetches 5m bars for `^NSEI` from Yahoo Finance; set `DATA_SYMBOL` to change the symbol.
- Behavior: this tool uses Yahoo's public chart API to get 5m bars and prints RSI(14) and a 21-period EMA of RSI every 5 minutes. It requires no provider API keys.
- Note: External providers may have rate limits and API key requirements; prefer TwelveData for reliable intraday data and set `DATA_SYMBOL` to the provider’s NIFTY symbol if required.

**Behavior & Safety**
- The strategy is live by default and will attempt to place real orders. Please use a test/pre-production account or reduce lot sizes while debugging. You are responsible for risk management.
- Always confirm the following before running in production: credentials & TOTP are correct, sufficient margin, and correct `merged_instruments.json` is accessible.
- Logs are printed to the console — monitor them for order confirmations, target/stop acceptance, or errors.

**Notes & Considerations**
- The strategy restricts options to NIFTY options on the NFO exchange and only considers the nearest expiry (current week or month depending on availability).
- Option selection is a heuristic: it looks for an option whose LTP is closest to `TARGET_PREMIUM` within a window of strikes. Adjust strike window or target premium as needed.
- GTT semantics differ across brokers. The current approach places target & stop as separate orders using Shoonya endpoints; if your platform supports formal GTT creation, adapt `src/strategies/lib/order-handler.ts` accordingly.
- Validate the indicator values with a trusted reference (e.g., TradingView or Zerodha) before going live.

**Troubleshooting**
- If the strategy fails to find options or returns empty lists: run `node src/updateInstruments.ts` to refresh `merged_instruments.json` and ensure that the `NFO` instruments are present.
- If Yahoo returns insufficient bars for 5-minute candles, the strategy attempts fallback ranges (7d/3d/1d). If insufficient history remains, the strategy logs a warning and waits for the next candle.
- `getQuotes` and `getStockList` call the MCP API; if authentication fails, make sure `.env` values are correct and TOTP works.

If you want help creating a safer sandbox or adding a simulated dry-run mode, I can add a configuration option or mock order handler for testing.

## 🛠️ Tech Stack

- **Backend**: Node.js
- **Broker API**: Finvasia Shoonya (MCP)

# Finvasia MCP Integration

This repository provides a basic integration setup for **Finvasia API** with the **Model Context Protocol (MCP)** server. It enables you to connect and access your Finvasia account through a standardized stdio interface, allowing seamless compatibility with MCP-based applications.

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/HexaMCP/Finvasia.git
cd Finvasia
```

### 2. Install Dependencies

```bash
npm install
```

## 🔐 3. Environment Setup

Create a .env file in the root directory with the following keys from Finvasia:

```bash
ID="Your Finvasia ID"
PASSWORD="Your Password"
VENDOR_KEY="Your Vendor Key"
IMEI="Your IMEI"
API_KEY="Your API Key"
TOTP="Your TOTP Code"
```

### 4. Build the Project

```bash
npm run build
```

### 5. Start the Project

```bash
npm start
```

Start the MCP server in your respective port (ex: http://localhost:3000)


### ⚙️ MCP Configuration for SSE

In your mcp config json, add the following configuration block:

```json
{
  "Your MCP project name": {
    "type": "sse",
    "url": "http://localhost:3000",
  }
}
````

🗂️ Where to add this configuration:

For VS Code users, this config should be placed inside your settings.json.

## 📞 Support

For any issues or assistance with the integration, please contact **[blaze.ws](https://blaze.ws)** for support.

You can reach out to us for troubleshooting, feature requests, or any general inquiries related to this MCP integration.
