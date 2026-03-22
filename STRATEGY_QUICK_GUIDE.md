# NIFTY Options Strategy - Quick Guide

## **📥 ENTRY SIGNALS**

**Two Trading Sessions:**
- Session 1: 9:25 AM - 11:00 AM
- Session 2: 12:30 PM - 2:00 PM

**Mandatory Filter:** ADX > 18 (trend strength)

**Bullish (Buy CE):**

**Condition 1 (All Sessions):**
- RSI crosses above RSI-EMA + RSI increases ≥3 points + |RSI - RSI-EMA| > 2 + RSI > 40

**Condition 2 (Session 1 ONLY - 9:25-11:00 AM):**
- RSI crosses above 65 + RSI increases ≥3 points + |RSI - RSI-EMA| > 2

**Note:** EITHER condition triggers entry. Condition 2 disabled in Session 2.

**Bearish (Buy PE):**

**Condition 1 (All Sessions):**
- RSI crosses below RSI-EMA + RSI decreases ≥3 points + |RSI - RSI-EMA| > 2 + (RSI < 60 if RSI > 50 OR RSI < 35 if RSI ≤ 50)

**Condition 2 (Session 1 ONLY - 9:25-11:00 AM):**
- RSI crosses below 40 + RSI decreases ≥3 points + |RSI - RSI-EMA| > 2

**Note:** EITHER condition triggers entry. Condition 2 disabled in Session 2.

**Entry Process:**
- Signal detected on 5-min candle close
- ADX validation (reject if ≤ 18)
- Search option near ₹90 premium
- Market order execution
- Position tracking starts (monitored every 2 seconds)

---

## **📤 EXIT SIGNALS**

**🚫 NO REVERSAL EXITS** - Opposite signals completely ignored when position active

**5 Exit Scenarios:**

### **1. Target (+50%)**
- Exit at Entry × 1.50
- Example: ₹90 → ₹135
- Immediate market exit
- Continuous monitoring (every 2 sec)

### **2. Stop Loss (-20%)**
- Exit at Entry × 0.80
- Example: ₹90 → ₹72
- Immediate market exit
- 5 retry verification

### **3. Trailing Stop (15% from entry)**
- Trailing Stop = Highest Price - (Entry × 15%)
- Never trails below initial stop
- **Profit Lock:** At +₹10 profit, locks minimum ₹10 gain
- Example: Entry ₹90 → High ₹115 → Trailing stop ₹101.50

### **4. Momentum Fading**
- Exit if profit < 10% after 15 minutes
- Prevents slow/dead positions
- Auto-exit with current P&L

### **5. Session Time Exits**
- Session 1: Force exit 11:30 AM
- Session 2: Force exit 3:05 PM
- Final cleanup: 3:05 PM (all positions)

---

## **🛡️ RISK MANAGEMENT**

### **Position Rules:**
- Max 1 position (CE or PE, never both)
- LONG only (buy options, never sell)
- NRML product (margin-based)
- Target premium: ₹90 options

### **Profit/Loss Targets:**
| Metric | Value | Example (₹90) |
|--------|-------|---------------|
| Target | +50% | ₹135 (+₹45) |
| Stop Loss | -20% | ₹72 (-₹18) |
| Trailing | 15% from entry | ₹76.50 @ ₹100 high |
| Profit Lock | +₹10 points | ₹100 minimum |
| Momentum | +10% in 15min | ₹99 required |

**Risk:Reward = 1:2.5** (Risk ₹18 for ₹45 reward)

### **Time Controls:**
- Session 1 max hold: 2h 5min (9:25-11:30)
- Session 2 max hold: 2h 35min (12:30-3:05)
- Momentum timeout: 15 minutes
- Daily cutoff: 3:05 PM (hard stop)

### **Monitoring:**
- Position checks: Every 2 seconds
- Candle analysis: Every 5 minutes
- API verification: All executions confirmed
- Trend filter: ADX > 18 mandatory

### **Safety Features:**
- Pre-entry cleanup verification
- Profit lock mechanism (min ₹10)
- Trailing never below initial stop
- Force exit at session times
- End-of-day cleanup with retry logic

---

## **🚀 RUN COMMAND**

```bash
npm start
```

**Program Lifecycle:** Single daily run → Exits at 3:05 PM → Manual restart required next day

---

## **📊 TECHNICAL SETUP**

- **Indicators:** RSI(14), RSI-EMA(21), ADX(14)
- **Candles:** 5-minute (starting 9:15 AM)
- **Instrument:** NIFTY 50 Index Options
- **Exchange:** NSE NFO
- **Data Source:** Shoonya API (historical) + WebSocket (live)
