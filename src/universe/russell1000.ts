// ─── Russell 1000 Universe ───────────────────────────────────
// Static constituent list — updated quarterly via KV override.
// Source: FTSE Russell reconstitution (June annually, quarterly updates).
// Last updated: 2026-Q2 baseline.
//
// Architecture:
// 1. Static list below = baseline (always available, zero latency)
// 2. KV key 'R1K_UNIVERSE' = override (updated via /api/universe-refresh)
// 3. Pre-market scan batches all ~1000 symbols through TV scanner
// 4. Scored → promoted → fed to all 6 engines

import { createLogger } from '../utils/logger';

const logger = createLogger('Universe');

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
  // Additional large/mid-caps not sector-classified above
  'BRK.A','SPY','QQQ','IWM',
  // Recently IPO'd / reclassified large caps
  'ARM','BIRK','VIK','CART','IBTA','ONON','GRAB',
];

// ─── Combined Universe ──────────────────────────────────────

export const RUSSELL_1000_STATIC: string[] = [
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

// Deduplicate
const _deduped = [...new Set(RUSSELL_1000_STATIC)];
export const RUSSELL_1000_COUNT = _deduped.length;

// ─── Sector Metadata ────────────────────────────────────────

export const SECTOR_MAP: Record<string, string[]> = {
  Technology: R1K_TECHNOLOGY,
  Healthcare: R1K_HEALTHCARE,
  Financials: R1K_FINANCIALS,
  'Consumer Discretionary': R1K_CONSUMER_DISCRETIONARY,
  'Consumer Staples': R1K_CONSUMER_STAPLES,
  Industrials: R1K_INDUSTRIALS,
  Energy: R1K_ENERGY,
  Utilities: R1K_UTILITIES,
  'Real Estate': R1K_REAL_ESTATE,
  Materials: R1K_MATERIALS,
  'Communication Services': R1K_COMMUNICATION_SERVICES,
};

// ─── Universe Access Functions ──────────────────────────────

/**
 * Get the full Russell 1000 universe.
 * Priority: KV override → static list.
 * KV override allows quarterly updates without redeploying.
 */
export async function getRussell1000(kv?: KVNamespace): Promise<string[]> {
  // Try KV override first (allows runtime updates)
  if (kv) {
    try {
      const override = await kv.get('R1K_UNIVERSE');
      if (override) {
        const symbols = JSON.parse(override) as string[];
        if (symbols.length > 500) {
          logger.info(`Using KV R1K override: ${symbols.length} symbols`);
          return symbols;
        }
      }
    } catch {
      logger.warn('KV R1K override read failed, using static list');
    }
  }

  return _deduped;
}

/**
 * Get universe split into batches for TV scanner.
 * Each batch is sized for a single TV API request.
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
 * Save a fresh R1K universe to KV (e.g., after quarterly reconstitution).
 */
export async function updateRussell1000(kv: KVNamespace, symbols: string[]): Promise<void> {
  await kv.put('R1K_UNIVERSE', JSON.stringify(symbols), {
    metadata: { updatedAt: new Date().toISOString(), count: symbols.length },
  });
  logger.info(`Updated R1K universe in KV: ${symbols.length} symbols`);
}
