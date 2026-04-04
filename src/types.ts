// ─── YMSA Types ──────────────────────────────────────────────
// Core type definitions for the financial automation system

/**
 * Cloudflare Worker environment bindings
 */
export interface Env {
  // API Keys (stored as Wrangler secrets)
  YMSA_API_KEY?: string;         // Auth key for HTTP endpoints
  ALPHA_VANTAGE_API_KEY: string;
  TAAPI_API_KEY: string;
  FINNHUB_API_KEY: string;
  FRED_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;

  // v3: Broker API Keys
  ALPACA_API_KEY?: string;
  ALPACA_SECRET_KEY?: string;

  // Environment variables (from wrangler.toml)
  ENVIRONMENT: string;
  TIMEZONE: string;
  DEFAULT_WATCHLIST: string;
  CRYPTO_WATCHLIST: string;
  TIER1_WATCHLIST: string;
  TIER2_WATCHLIST: string;
  ETF_WATCHLIST: string;
  EXPANDED_CRYPTO_WATCHLIST: string;
  ALPACA_PAPER_MODE: string;
  RSI_OVERBOUGHT: string;
  RSI_OVERSOLD: string;
  EMA_FAST: string;
  EMA_SLOW: string;
  FIBO_LEVELS: string;
  FIBO_EXTENSIONS: string;
  ALERT_PROXIMITY_52W: string;
  VOLUME_SPIKE_MULTIPLIER: string;

  // Google Auth
  GOOGLE_CLIENT_ID: string;

  // Cloudflare Bindings
  BROWSER: any;              // Browser Rendering (Playwright)
  YMSA_CACHE?: KVNamespace;  // KV cache
  YMSA_DATA?: R2Bucket;      // R2 storage
  DB: D1Database;            // D1 database (always bound)
  AI?: any;                  // Workers AI (Z.AI engine)
  ORCHESTRATOR?: DurableObjectNamespace;  // Durable Object
  PORTFOLIO?: DurableObjectNamespace;     // Durable Object
}

/**
 * Stock quote data from any API source
 */
export interface StockQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  avgVolume: number;
  high?: number;
  low?: number;
  open?: number;
  previousClose?: number;
  week52High: number;
  week52Low: number;
  marketCap?: number;
  pe?: number;
  timestamp: number;
  source?: DataSource;
}

/**
 * Technical indicator result
 */
export interface TechnicalIndicator {
  symbol: string;
  indicator: IndicatorType;
  value: number;
  signal?: number;
  histogram?: number;
  timestamp: number;
  timeframe: Timeframe;
}

export type IndicatorType =
  | 'RSI'
  | 'EMA_9'
  | 'EMA_21'
  | 'EMA_50'
  | 'EMA_55'
  | 'EMA_200'
  | 'SMA_20'
  | 'SMA_50'
  | 'SMA_200'
  | 'MACD'
  | 'MACD_SIGNAL'
  | 'MACD_HISTOGRAM'
  | 'BOLLINGER_UPPER'
  | 'BOLLINGER_LOWER'
  | 'BOLLINGER_MIDDLE'
  | 'VOLUME_SMA_20'
  | 'ATR'
  | 'ADX'
  | 'STOCH_RSI'
  | 'STOCH_K'
  | 'STOCH_D'
  | 'OBV'
  | 'VWAP'
  | 'SUPERTREND'
  | 'WILLIAMS_R'
  | 'CCI'
  | 'PSAR'
  | 'ICHIMOKU_CONVERSION'
  | 'ICHIMOKU_BASE'
  | 'ICHIMOKU_SPAN_A'
  | 'ICHIMOKU_SPAN_B';

export type Timeframe = '1min' | '5min' | '15min' | '1h' | '4h' | 'daily' | 'weekly' | 'monthly';
export type DataSource = 'alpha_vantage' | 'finnhub' | 'taapi' | 'yahoo_finance' | 'finviz' | 'coingecko' | 'dexscreener' | 'tradingview' | 'cnbc' | 'marketwatch' | 'stocktwits' | 'sec_edgar';

/**
 * Fibonacci retracement calculation result
 */
export interface FibonacciResult {
  symbol: string;
  swingHigh: number;
  swingLow: number;
  direction: 'uptrend' | 'downtrend';
  levels: FibLevel[];
  extensions: FibLevel[];
  currentPrice: number;
  nearestLevel: FibLevel | null;
  timestamp: number;
}

export interface FibLevel {
  ratio: number;
  label: string;
  price: number;
  distancePercent: number;
}

/**
 * Screening result for a single stock
 */
export interface ScreeningResult {
  symbol: string;
  quote: StockQuote;
  indicators: TechnicalIndicator[];
  fibonacci?: FibonacciResult;
  signals: Signal[];
  score: number; // Composite signal strength 0-100
  timestamp: number;
}

/**
 * Trading signal/alert
 */
export interface Signal {
  type: SignalType;
  priority: AlertPriority;
  symbol: string;
  title: string;
  description: string;
  value: number;
  threshold?: number;
  timestamp: number;
}

export type SignalType =
  | 'RSI_OVERSOLD'
  | 'RSI_OVERBOUGHT'
  | 'GOLDEN_CROSS'
  | 'DEATH_CROSS'
  | 'EMA_CROSSOVER'
  | 'MACD_BULLISH_CROSS'
  | 'MACD_BEARISH_CROSS'
  | 'MACD_HISTOGRAM_DIVERGENCE'
  | '52W_HIGH_PROXIMITY'
  | '52W_LOW_PROXIMITY'
  | '52W_BREAKOUT'
  | '52W_BREAKDOWN'
  | 'FIBONACCI_LEVEL_HIT'
  | 'VOLUME_SPIKE'
  | 'PRICE_ALERT'
  // v3: Multi-timeframe signals
  | 'MTF_CONFLUENCE_BUY'
  | 'MTF_CONFLUENCE_SELL'
  | 'MTF_MEAN_REVERSION'
  // v3: Smart Money signals
  | 'ORDER_BLOCK_BUY'
  | 'ORDER_BLOCK_SELL'
  | 'FAIR_VALUE_GAP'
  | 'LIQUIDITY_SWEEP'
  | 'BREAK_OF_STRUCTURE'
  | 'INSIDER_BUY'
  // v3: Pairs / Stat-Arb signals
  | 'PAIR_LONG_SPREAD'
  | 'PAIR_SHORT_SPREAD'
  | 'PAIR_CLOSE'
  // v3: Options signals
  | 'SELL_PUT'
  | 'SELL_CALL'
  | 'IRON_CONDOR'
  // v3: Crypto signals
  | 'FUNDING_RATE_ARB'
  | 'WHALE_ACCUMULATION'
  | 'DEX_NEW_PAIR'
  // v3: Event-driven signals
  | 'EARNINGS_PLAY'
  | 'MACRO_EVENT'
  | 'REGIME_CHANGE'
  | 'NEWS_CATALYST';

export type AlertPriority = 'CRITICAL' | 'IMPORTANT' | 'INFO';

/**
 * Alert message ready to send
 */
export interface AlertMessage {
  priority: AlertPriority;
  channel: AlertChannel;
  symbol: string;
  title: string;
  body: string;
  timestamp: number;
}

export type AlertChannel = 'telegram' | 'whatsapp' | 'email';

/**
 * Cron job type identifier
 */
export type CronJobType =
  | 'MORNING_BRIEFING'
  | 'MARKET_OPEN_SCAN'
  | 'QUICK_SCAN_15MIN'
  | 'FULL_SCAN_HOURLY'
  | 'EVENING_SUMMARY'
  | 'AFTER_HOURS_SCAN'
  | 'WEEKLY_REVIEW'
  // v3: New job types
  | 'PRE_MARKET_SETUP'
  | 'OPENING_RANGE_BREAK'
  | 'QUICK_PULSE_5MIN'
  | 'MIDDAY_REBALANCE'
  | 'OVERNIGHT_SETUP'
  | 'DAILY_SUMMARY'
  | 'ML_RETRAIN'
  | 'PAIRS_RECALIBRATE'
  | 'MONTHLY_PERFORMANCE';

/**
 * OHLCV candle data for Fibonacci calculation
 */
export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Screening rule configuration
 */
export interface ScreeningRule {
  name: string;
  enabled: boolean;
  conditions: ScreeningCondition[];
  priority: AlertPriority;
}

export interface ScreeningCondition {
  indicator: IndicatorType | 'PRICE' | 'VOLUME' | '52W_POSITION';
  operator: '>' | '<' | '>=' | '<=' | '==' | 'CROSSES_ABOVE' | 'CROSSES_BELOW';
  value: number;
}

/**
 * Watchlist entry with metadata
 */
export interface WatchlistEntry {
  symbol: string;
  name: string;
  sector?: string;
  addedAt: number;
  notes?: string;
  customAlerts?: ScreeningRule[];
}
