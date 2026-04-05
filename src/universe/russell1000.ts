// ─── Russell 1000 Universe ───────────────────────────────────
// Dynamic + static hybrid approach:
//   1. Dynamic: TV scanner top 1050 by market cap → KV cached (weekly refresh)
//   2. Static: Curated baseline (~1000 symbols) → fallback when TV/KV unavailable
//   3. Merged: union of both for maximum coverage
//
// Why not static-only: The Russell 1000 reconstitutes quarterly + IPOs/delistings.
// Why not dynamic-only: TV may be unavailable / rate-limited. Static is zero-latency.
//
// Architecture:
// 1. Pre-market: fetchDynamicR1K() → store in KV → merge with static → scan all
// 2. During market: KV-cached dynamic list (no re-fetch)
// 3. Fallback: static list if KV + TV both unavailable

import { createLogger } from '../utils/logger';

const logger = createLogger('Universe');

// ─── Defunct / Acquired / Delisted — exclude from static list ───
const DEFUNCT_SYMBOLS = new Set([
  'SIVB','PACW','FRC','SGEN','HZNP','PXD','CTLT','GCP',  // Acquired/failed 2023-2025
  'ATVI','TWTR','VMW',  // Acquired by MSFT/X/AVGO
]);

// ETFs are NOT Russell 1000 constituents
const NON_R1K = new Set(['SPY','QQQ','IWM','BRK.A']);

// ─── Russell 1000 Constituents (Top ~1000 US stocks by market cap) ───
// Organized by sector for operational visibility.
// This list covers ~93% of US equity market cap.

const R1K_TECHNOLOGY = [
  'AAPL','MSFT','NVDA','AVGO','ORCL','CRM','AMD','ADBE','CSCO','ACN',
  'INTC','IBM','NOW','INTU','QCOM','TXN','AMAT','PANW','MU','LRCX',
  'ADI','KLAC','SNPS','CDNS','CRWD','MRVL','FTNT','WDAY','ROP','ANSS',
  'ADSK','NXPI','MCHP','ON','KEYS','CDW','FSLR','SMCI','MPWR','SWKS',
  'ZBRA','TER','EPAM','ENPH','CTSH','AKAM','FFIV','NTAP','WDC','STX',
  'JNPR','HPE','HPQ','DELL','ANET','PLTR','DDOG','ZS','NET','TEAM',
  'SNOW','MDB','HUBS','VEEV','DOCU','OKTA','BILL','PCOR','CFLT','ESTC',
  'MNDY','ZI','BSY','GLOB','CIEN','SYNA','AMKR','COHR','LITE','IIVI',
  'MANH','PAYC','VRNS','TENB','QLYS','CYBR','SAIL','ALRM','CALX','VIAV',
  'PSTG','ASAN','IOT','PATH','APP','RBRK','DUOL','GTLB',
];

const R1K_HEALTHCARE = [
  'LLY','UNH','JNJ','ABBV','MRK','TMO','ABT','DHR','AMGN','PFE',
  'ISRG','MDT','BMY','GILD','VRTX','SYK','BSX','ELV','REGN','ZTS',
  'BDX','CI','HCA','MCK','IDXX','IQV','EW','A','MTD','RMD',
  'DXCM','HOLX','TFX','BAX','ALGN','WST','ZBH','COO','LH','DGX',
  'TECH','BIO','CRL','RVTY','INCY','SGEN','HZNP','BMRN','EXAS','NTRA',
  'VEEV','IRTC','GMED','OMCL','NVST','RGEN','AZTA','TXG','RARE','RCKT',
  'MRNA','ALNY','IONS','SRPT','NBIX','PCVX','BNTX','UTHR','MEDP','IART',
  'XRAY','HSIC','HAE','ENSG','AMED','CHE','SEM','NHC','SGRY','PRGO',
  'OGN','CTLT','VTRS','TAK','TEVA','JAZZ','ITCI','CORT','AXSM','DVAX',
  'KRYS','ARVN','RVMD','IMVT','TWST','CRNX',
];

const R1K_FINANCIALS = [
  'BRK.B','JPM','V','MA','BAC','WFC','GS','MS','SPGI','BLK',
  'C','AXP','SCHW','CB','PGR','MMC','ICE','CME','AON','USB',
  'PNC','TFC','MET','AIG','AFL','PRU','MCO','MSCI','TRV','ALL',
  'AMP','NDAQ','BK','STT','FITB','RF','HBAN','KEY','CFG','MTB',
  'NTRS','CINF','RJF','CBOE','MKTX','IEX','SEIC','SF','EVR','HLI',
  'IBKR','LPLA','HOOD','COIN','WRB','RNR','EG','AJG','ERIE','HIG',
  'GL','KMPR','ORI','AFG','THG','RLI','ACGL','KNSL','RYAN','BRO',
  'FNF','DFS','SYF','COF','ALLY','OMF','SOFI','LC','CACC','WRLD',
  'WAL','EWBC','SIVB','PACW','FRC','CMA','ZION','BOKF','SNV','FHN',
  'VLY','UMBF','PNFP','GBCI','ABCB','FFBC',
];

const R1K_CONSUMER_DISCRETIONARY = [
  'AMZN','TSLA','HD','MCD','NKE','SBUX','TJX','LOW','BKNG','ABNB',
  'ORLY','CMG','MAR','DHI','LEN','HLT','YUM','ROST','EBAY','DKNG',
  'DPZ','POOL','GRMN','PHM','TOL','NVR','BBY','TPR','ULTA','DECK',
  'WSM','RH','TXRH','WING','CAVA','BROS','SHAK','DRI','LVS','WYNN',
  'CZR','MGM','PENN','RSI','NCLH','RCL','CCL','EXPE','LYFT','UBER',
  'DASH','LULU','GPS','ANF','AEO','URBN','FIVE','OLLI','DKS','BURL',
  'KMX','CVNA','RACE','APTV','BWA','LEA','GPC','LKQ','VC',
  'GNTX','MOD','AXL','DAN','LCII','THO','WGO','FOXF','CWH','HOG',
  'PII','BC','MLI','SWK','WHR','CARR','LII','TT','JCI',
];

const R1K_CONSUMER_STAPLES = [
  'PG','KO','PEP','COST','WMT','PM','MO','MNST','CL','EL',
  'KMB','GIS','SJM','K','HSY','HRL','TSN','CAG','MKC','CPB',
  'ADM','BG','INGR','DAR','VITL','THS','POST','FLO','LNTH',
  'WBA','CVS','CASY','BJ','DG','DLTR','KR','ACI','SFM','GO',
  'USFD','SYY','PFGC','CHEF','JJSF','CORE','FRPT','CLX','CHD',
  'SPB','CLORX','EPC','ENR','HELE','NWL','BRBR','CELH','SAM','STZ',
  'BF.B','DEO','TAP','MNST','KDP','FIZZ',
];

const R1K_INDUSTRIALS = [
  'GE','CAT','RTX','UNP','HON','UPS','DE','BA','LMT','GD',
  'NOC','ETN','ITW','PH','EMR','GEV','TT','MMM','FDX','CSX',
  'NSC','ROK','CMI','DOV','AME','OTIS','SNA','IR','XYL','NDSN',
  'IEX','GGG','RBC','AAON','WSO','RRX','SWK','GNRC','MIDD','MAS',
  'FAST','POOL','WAB','TDG','HWM','AXON','BLBD','GBX','ATKR','ROAD',
  'PRIM','STRL','WMS','SITE','BLDR','FIX','AIT','EXPO','BWXT','HEI',
  'TDY','LDOS','BAH','KBR','SAIC','CACI','KTOS','LHX','HII','TXT',
  'WM','RSG','WCN','SRCL','CLH','ACV','VRRM','HRI','URI','LECO',
  'MTZ','PWR','TTEK','DY','MYR','AGX','UFPI','BLD','FERG','WSC',
  'CNH','AGCO','CNHI','TTC','REVG','ALG',
];

const R1K_ENERGY = [
  'XOM','CVX','COP','EOG','SLB','MPC','PSX','VLO','PXD','OXY',
  'HES','DVN','FANG','HAL','BKR','CTRA','MRO','APA','EQT','OVV',
  'AR','RRC','SWN','LBRT','CHX','HP','PTEN','WHD','FTI','TDW',
  'OII','NE','VAL','WFRD','CLB','AESI','TRGP','WMB','KMI','OKE',
  'ET','MPLX','EPD','PAA','AM','HESM','DTM','CIVI','MTDR','MGY',
  'CHRD','SM','PR','NOG','VTLE','ESTE','CPE','GPOR','NFE','TPL',
];

const R1K_UTILITIES = [
  'NEE','SO','DUK','CEG','SRE','AEP','D','ED','EXC','XEL',
  'PEG','WEC','ES','AWK','PPL','CMS','EVRG','DTE','FE','AES',
  'ATO','NI','NRG','VST','CNP','OGE','PNW','LNT','MGEE','AVA',
  'BKH','NWE','SJW','OTTR','UTL','HE','IDA','POR','SR','WTRG',
];

const R1K_REAL_ESTATE = [
  'PLD','AMT','CCI','EQIX','PSA','O','SPG','WELL','DLR','VICI',
  'CBRE','ARE','EXR','AVB','EQR','MAA','UDR','CPT','ESS','INVH',
  'SUI','ELS','AMH','REXR','FR','PLD','STAG','TRNO','LTC','OHI',
  'SBRA','HR','VTR','PEAK','DOC','HST','RHP','PK','APLE',
  'IRM','LAMR','SBAC','CTO','GTY','NNN','ADC','BNL','EPRT','FCPT',
  'KIM','REG','BRX','SITC','RPT','IRT','ELME','KRG',
];

const R1K_MATERIALS = [
  'LIN','APD','SHW','ECL','DD','NEM','FCX','NUE','PPG','VMC',
  'MLM','ALB','CE','EMN','RPM','FMC','MOS','CF','OLN','SEE',
  'IP','PKG','WRK','SLVM','ATR','AVNT','ASH','HUN','CC','CBT',
  'TROX','KWR','IOSP','GEF','SON','BERY','AMCR','GPK','TRS',
  'RS','CRS','ATI','HAYN','CMC','STLD','CLF','X','AA','CENX',
  'CMP','AXTA','GCP','NGVT','BCPC','KOP','GMS','USLM',
];

const R1K_COMMUNICATION_SERVICES = [
  'META','GOOGL','GOOG','NFLX','DIS','CMCSA','T','VZ','TMUS','CHTR',
  'EA','TTWO','RBLX','MTCH','SPOT','WBD','PARA','FOX','FOXA','NWSA',
  'NWS','LYV','IPG','OMC','CCI','ZG','Z','PINS','SNAP','ROKU',
  'TTD','MGNI','DV','PUBM','CRTO','QNST','CARG','YELP','ANGI','IAC',
  'MSGS','LGF.A','SIRI','LUMN','FYBR','CABO','ATUS','UNIT',
];

const R1K_MISC = [
  // Recently IPO'd / reclassified large caps not yet in sector lists
  'ARM','BIRK','VIK','CART','IBTA','ONON','GRAB',
  // Additional large/mid-caps commonly in R1K
  'RIVN','LCID','JOBY','RKLB','ASTS','IONQ','RGTI','OKLO',
  'SMMT','TMDX','NUVL','KYMR','ZETA','RDDT','CWAN','FRSH',
  'ALKT','GFS','ACHR','PRCH','COUR','INST','BASE','GENI',
  'TOST','BRZE','DKNG','ABNB','DASH','LI','NIO','XPEV',
  'CELH','MNDY','CRSP','NTLA','BEAM','EDIT','INSP','TNDM',
  'CERT','AMBA','LSCC','RMBS','CRUS','WOLF','MTSI','PI',
  'HLNE','STEP','OWL','ARES','APO','KKR','CG','BAM',
  'BN','TPG','BLUE','APLS','SRRK','MRUS','PCVX','XNCR',
  'FOLD','BGNE','LEGN','WIX','GLOB','NICE','DOX','RNG',
  'FIVN','TWLO','CAMT','ONTO','AEHR','FORM','ACLS',
];

// ─── Combined Static Universe ────────────────────────────────

const _raw = [
  ...R1K_TECHNOLOGY,
  ...R1K_HEALTHCARE,
  ...R1K_FINANCIALS,
  ...R1K_CONSUMER_DISCRETIONARY,
  ...R1K_CONSUMER_STAPLES,
  ...R1K_INDUSTRIALS,
  ...R1K_ENERGY,
  ...R1K_UTILITIES,
  ...R1K_REAL_ESTATE,
  ...R1K_MATERIALS,
  ...R1K_COMMUNICATION_SERVICES,
  ...R1K_MISC,
];

// Deduplicate + remove defunct/ETFs
const _staticSet = new Set(_raw.filter(s => !DEFUNCT_SYMBOLS.has(s) && !NON_R1K.has(s)));
export const RUSSELL_1000_STATIC: string[] = [..._staticSet];
export const RUSSELL_1000_COUNT = RUSSELL_1000_STATIC.length;

/** O(1) lookup: is this symbol a verified static R1K constituent? */
export const STATIC_R1K_SET: ReadonlySet<string> = _staticSet;

// ─── Sector Metadata ────────────────────────────────────────

export const SECTOR_MAP: Record<string, string[]> = {
  Technology: R1K_TECHNOLOGY.filter(s => !DEFUNCT_SYMBOLS.has(s)),
  Healthcare: R1K_HEALTHCARE.filter(s => !DEFUNCT_SYMBOLS.has(s)),
  Financials: R1K_FINANCIALS.filter(s => !DEFUNCT_SYMBOLS.has(s)),
  'Consumer Discretionary': R1K_CONSUMER_DISCRETIONARY.filter(s => !DEFUNCT_SYMBOLS.has(s)),
  'Consumer Staples': R1K_CONSUMER_STAPLES.filter(s => !DEFUNCT_SYMBOLS.has(s)),
  Industrials: R1K_INDUSTRIALS.filter(s => !DEFUNCT_SYMBOLS.has(s)),
  Energy: R1K_ENERGY.filter(s => !DEFUNCT_SYMBOLS.has(s)),
  Utilities: R1K_UTILITIES,
  'Real Estate': R1K_REAL_ESTATE.filter(s => !DEFUNCT_SYMBOLS.has(s)),
  Materials: R1K_MATERIALS.filter(s => !DEFUNCT_SYMBOLS.has(s)),
  'Communication Services': R1K_COMMUNICATION_SERVICES.filter(s => !DEFUNCT_SYMBOLS.has(s)),
};

// ─── Dynamic Universe Fetcher ───────────────────────────────

const R1K_DYNAMIC_KV_KEY = 'R1K_DYNAMIC';
const R1K_DYNAMIC_TTL_HOURS = 24; // Refresh daily

/**
 * Fetch the top ~1000 US stocks by market cap from TradingView.
 * This IS the real-time Russell 1000 — defined as the top 1000 US stocks by market cap.
 * Stores result in KV for reuse within TTL.
 */
export async function fetchDynamicR1K(kv?: KVNamespace): Promise<string[]> {
  // Check KV cache first
  if (kv) {
    try {
      const cached = await kv.get(R1K_DYNAMIC_KV_KEY, 'json') as { symbols: string[]; ts: number } | null;
      if (cached && Date.now() - cached.ts < R1K_DYNAMIC_TTL_HOURS * 3600 * 1000) {
        logger.info(`Using cached dynamic R1K: ${cached.symbols.length} symbols (age: ${((Date.now() - cached.ts) / 3600000).toFixed(1)}h)`);
        return cached.symbols;
      }
    } catch { /* cache miss */ }
  }

  // Fetch from TV — dynamic import to avoid circular dependency
  try {
    const { fetchTopByMarketCap } = await import('../api/tradingview');
    const results = await fetchTopByMarketCap(1050);
    if (results.length < 500) {
      logger.warn(`TV top-by-market-cap returned only ${results.length} — using static list`);
      return [];
    }

    const symbols = results.slice(0, 1000).map(r => r.symbol);
    logger.info(`Dynamic R1K fetched: ${symbols.length} symbols from TV market-cap ranking`);

    // Cache in KV
    if (kv) {
      try {
        await kv.put(R1K_DYNAMIC_KV_KEY, JSON.stringify({ symbols, ts: Date.now() }), {
          expirationTtl: R1K_DYNAMIC_TTL_HOURS * 3600,
        });
      } catch { /* KV write failure — non-fatal */ }
    }

    return symbols;
  } catch (err) {
    logger.error('Dynamic R1K fetch failed', err);
    return [];
  }
}

// ─── Universe Access Functions ──────────────────────────────

/**
 * Get the full Russell 1000 universe.
 * Priority: Dynamic (TV top 1000 by market cap) merged with static baseline.
 * This ensures maximum coverage: dynamic catches reconstitutions, static catches TV gaps.
 */
export async function getRussell1000(kv?: KVNamespace): Promise<string[]> {
  // Try KV manual override first (allows admin updates)
  if (kv) {
    try {
      const override = await kv.get('R1K_UNIVERSE');
      if (override) {
        const symbols = JSON.parse(override) as string[];
        if (symbols.length > 500) {
          logger.info(`Using KV R1K manual override: ${symbols.length} symbols`);
          return symbols;
        }
      }
    } catch {
      logger.warn('KV R1K override read failed');
    }
  }

  // Merge dynamic + static for maximum coverage
  const dynamic = await fetchDynamicR1K(kv);
  if (dynamic.length > 0) {
    const merged = [...new Set([...dynamic, ...RUSSELL_1000_STATIC])];
    logger.info(`R1K merged universe: ${dynamic.length} dynamic + ${RUSSELL_1000_STATIC.length} static = ${merged.length} unique`);
    return merged;
  }

  // Fallback to static only
  return RUSSELL_1000_STATIC;
}

/**
 * Get the dynamic-only R1K list (for dashboard stats).
 * Returns null if no dynamic list is available.
 */
export async function getDynamicR1KSymbols(kv?: KVNamespace): Promise<string[] | null> {
  if (!kv) return null;
  try {
    const cached = await kv.get(R1K_DYNAMIC_KV_KEY, 'json') as { symbols: string[]; ts: number } | null;
    if (cached && cached.symbols.length > 500) return cached.symbols;
  } catch { /* miss */ }
  return null;
}

/**
 * Get universe split into batches for TV scanner.
 */
export function getBatches(symbols: string[], batchSize: number = 100): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < symbols.length; i += batchSize) {
    batches.push(symbols.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Get sector breakdown counts.
 */
export function getSectorBreakdown(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [sector, symbols] of Object.entries(SECTOR_MAP)) {
    result[sector] = symbols.length;
  }
  return result;
}

/**
 * Save a manual R1K universe override to KV.
 */
export async function updateRussell1000(kv: KVNamespace, symbols: string[]): Promise<void> {
  await kv.put('R1K_UNIVERSE', JSON.stringify(symbols), {
    metadata: { updatedAt: new Date().toISOString(), count: symbols.length },
  });
  logger.info(`Updated R1K universe in KV: ${symbols.length} symbols`);
}
