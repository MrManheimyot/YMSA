// ─── Dashboard HTML body — all sections and layout ───

export const DASHBOARD_BODY = `
<div class="top-bar">
  <h1>📊 YMSA v3.4 — Trading Dashboard</h1>
  <div class="meta">
    <span id="last-update">Loading...</span>
    <div class="live-dot"></div>
    <span id="mode-badge" class="mode-badge signals">SIGNALS</span>
    <span style="font-family:'Roboto Mono',monospace">v3.4.0</span>
  </div>
</div>

<div class="container">

  <!-- ═══ PORTFOLIO HERO ═══ -->
  <div class="hero-grid" id="hero-grid">
    <div class="card"><div class="card-title">Total Equity</div><div class="card-value" id="h-equity">—</div><div class="card-sub">Portfolio value</div></div>
    <div class="card"><div class="card-title">Cash / Buying Power</div><div class="card-value-sm" id="h-cash">—</div><div class="card-sub" id="h-cash-sub">Available</div></div>
    <div class="card"><div class="card-title">Daily P&L</div><div class="card-value" id="h-daily-pnl">—</div><div class="card-sub" id="h-daily-pnl-sub">Today</div></div>
    <div class="card"><div class="card-title">Unrealized P&L</div><div class="card-value" id="h-unrealized">—</div><div class="card-sub">Open positions</div></div>
    <div class="card"><div class="card-title">Win Rate</div><div class="card-value" id="h-winrate">—</div><div class="card-sub">All engines</div></div>
    <div class="card"><div class="card-title">System Health</div><div class="card-value" id="h-health">—</div><div class="card-sub" id="h-health-sub">Worker status</div></div>
  </div>

  <!-- ═══ REGIME + ENGINES ═══ -->
  <div class="two-col">
    <div class="section">
      <div class="section-hdr">🌊 Market Regime</div>
      <div class="card" id="regime-panel">
        <div class="regime-row">
          <span class="regime-badge range" id="regime-badge">LOADING</span>
          <div class="regime-details">
            VIX: <span class="mono" id="regime-vix">—</span> &nbsp;|&nbsp;
            ADX: <span class="mono" id="regime-adx">—</span> &nbsp;|&nbsp;
            Confidence: <span class="mono" id="regime-conf">—</span>
          </div>
        </div>
        <div class="card-title">Engine Weight Adjustments</div>
        <div id="regime-weights" class="regime-details" style="margin-top:4px">Based on current regime</div>
      </div>
    </div>
    <div class="section">
      <div class="section-hdr">📈 P&L Sparkline (Last 14 Days)</div>
      <div class="card">
        <div class="sparkline" id="pnl-sparkline"><div class="empty">Collecting data...</div></div>
      </div>
    </div>
  </div>

  <!-- ═══ 6-ENGINE PERFORMANCE ═══ -->
  <div class="section">
    <div class="section-hdr">⚡ 6-Engine Performance</div>
    <div class="engine-grid" id="engine-grid"></div>
  </div>

  <!-- ═══ OPEN POSITIONS ═══ -->
  <div class="section">
    <div class="section-hdr">💼 Open Positions <span id="pos-count" style="font-family:'Roboto Mono',monospace;font-size:12px;color:var(--c-primary);margin-left:4px"></span></div>
    <div class="card" style="padding:0;overflow-x:auto">
      <table class="tbl" id="positions-table">
        <thead><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Current</th><th>P&L</th><th>P&L %</th><th>Engine</th></tr></thead>
        <tbody id="positions-body"><tr><td colspan="8" class="loading">Loading positions...</td></tr></tbody>
      </table>
    </div>
  </div>

  <!-- ═══ SIGNALS + RISK EVENTS ═══ -->
  <div class="two-col">
    <div class="section">
      <div class="section-hdr">📡 Recent Signals <span id="sig-count" class="mono" style="color:var(--c-primary);font-size:12px;margin-left:4px"></span></div>
      <div class="card scroll-panel" id="signals-panel"><div class="loading">Loading signals...</div></div>
    </div>
    <div class="section">
      <div class="section-hdr">🛡️ Risk Events</div>
      <div class="card scroll-panel" id="risk-events-panel"><div class="loading">Loading events...</div></div>
    </div>
  </div>

  <!-- ═══ RECENT TRADES ═══ -->
  <div class="section">
    <div class="section-hdr">📋 Recent Trades</div>
    <div class="card" style="padding:0;overflow-x:auto">
      <table class="tbl">
        <thead><tr><th>ID</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Exit</th><th>P&L</th><th>Status</th><th>Engine</th><th>Opened</th></tr></thead>
        <tbody id="trades-body"><tr><td colspan="10" class="loading">Loading trades...</td></tr></tbody>
      </table>
    </div>
  </div>

  <!-- ═══ GOOGLE ALERTS NEWS FEED ═══ -->
  <div class="section">
    <div class="section-hdr">📰 Google Alerts News Feed <span id="news-count" class="mono" style="color:var(--c-primary);font-size:12px;margin-left:4px"></span>
      <button class="test-btn" style="margin-left:auto;font-size:10px;padding:3px 10px" onclick="refreshNews()">⟳ Refresh</button>
    </div>
    <div class="two-col">
      <div class="card scroll-panel" id="news-panel" style="max-height:400px"><div class="loading">Loading news...</div></div>
      <div class="card">
        <div class="card-title">Feed Categories</div>
        <div id="news-feeds" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px"></div>
        <div class="card-title" style="margin-top:14px">Engine Mapping</div>
        <div id="news-engine-map" style="margin-top:4px;font-size:11px;color:var(--c-on-surface-2)"></div>
      </div>
    </div>
  </div>

  <!-- ═══ SUPERPOWER: RSS INTELLIGENCE ═══ -->
  <div class="section">
    <div class="section-hdr">📡 RSS Intelligence Feed <span id="rss-count" class="mono" style="color:var(--c-primary);font-size:12px;margin-left:4px"></span>
      <button class="test-btn" style="margin-left:auto;font-size:10px;padding:3px 10px" onclick="refreshRSS()">⟳ Refresh</button>
    </div>
    <div class="card scroll-panel" id="rss-panel" style="max-height:420px"><div class="loading">Loading RSS feeds...</div></div>
  </div>

  <!-- ═══ SUPERPOWER: SOCIAL SENTIMENT ═══ -->
  <div class="section">
    <div class="section-hdr">💬 Social Sentiment <span id="sentiment-count" class="mono" style="color:var(--c-primary);font-size:12px;margin-left:4px"></span></div>
    <div class="card" style="padding:0;overflow-x:auto">
      <table class="tbl" id="sentiment-table">
        <thead><tr><th>Symbol</th><th>Score</th><th>Bullish</th><th>Bearish</th><th>Messages</th><th>Watchers</th><th>Source</th><th>Updated</th></tr></thead>
        <tbody id="sentiment-body"><tr><td colspan="8" class="loading">Loading sentiment...</td></tr></tbody>
      </table>
    </div>
  </div>

  <!-- ═══ SUPERPOWER: TRADINGVIEW SCANNER ═══ -->
  <div class="section">
    <div class="section-hdr">📊 TradingView Scanner</div>
    <div class="tab-bar" id="tv-tabs">
      <button class="tab-btn active" onclick="switchTVTab('top_gainers', this)">🟢 Gainers</button>
      <button class="tab-btn" onclick="switchTVTab('top_losers', this)">🔴 Losers</button>
      <button class="tab-btn" onclick="switchTVTab('most_volatile', this)">⚡ Volatile</button>
      <button class="tab-btn" onclick="switchTVTab('oversold', this)">📉 Oversold</button>
      <button class="tab-btn" onclick="switchTVTab('high_volume', this)">📈 High Vol</button>
    </div>
    <div class="card" style="padding:0;overflow-x:auto">
      <table class="tbl" id="tv-table">
        <thead><tr><th>Symbol</th><th>Price</th><th>Change %</th><th>Volume</th><th>RSI</th><th>Sector</th></tr></thead>
        <tbody id="tv-body"><tr><td colspan="6" class="loading">Loading scanner...</td></tr></tbody>
      </table>
    </div>
  </div>

  <!-- ═══ SUPERPOWER: FEED HEALTH ═══ -->
  <div class="section">
    <div class="section-hdr">🏥 Data Feed Health <span id="feed-health-count" class="mono" style="color:var(--c-primary);font-size:12px;margin-left:4px"></span></div>
    <div class="card" style="padding:0;overflow-x:auto">
      <table class="tbl" id="feed-health-table">
        <thead><tr><th>Source</th><th>Total Fetches</th><th>Success</th><th>Success %</th><th>Avg Items</th><th>Consecutive Failures</th><th>Status</th></tr></thead>
        <tbody id="feed-health-body"><tr><td colspan="7" class="loading">Loading feed health...</td></tr></tbody>
      </table>
    </div>
  </div>

  <!-- ═══ CRON + APIS ═══ -->
  <div class="two-col">
    <div class="section">
      <div class="section-hdr">⏰ Cron Schedule</div>
      <div class="card" style="padding:0;overflow:hidden">
        <table class="tbl" id="cron-table">
          <thead><tr><th>Job</th><th>Schedule (UTC)</th><th>Description</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
    <div class="section">
      <div class="section-hdr">🌐 API Connectivity</div>
      <div class="api-grid" id="api-grid" style="margin-top:4px"></div>
    </div>
  </div>

  <!-- ═══ SECRETS + RISK LIMITS ═══ -->
  <div class="two-col">
    <div class="section">
      <div class="section-hdr">🔐 Secrets Status</div>
      <div class="chip-grid" id="secrets-grid" style="margin-top:4px"></div>
    </div>
    <div class="section">
      <div class="section-hdr">🛡️ Risk Limits</div>
      <div class="risk-grid" id="risk-grid" style="margin-top:4px"></div>
    </div>
  </div>

  <!-- ═══ ENDPOINTS ═══ -->
  <div class="section">
    <div class="section-hdr">📡 HTTP Endpoints (<span id="ep-count">0</span>)</div>
    <div class="endpoint-list" id="endpoint-list"></div>
  </div>

  <!-- ═══ LIVE TESTS ═══ -->
  <div class="section">
    <div class="section-hdr">🧪 Live Connectivity Tests</div>
    <div class="test-grid">
      <div class="test-panel">
        <div class="test-panel-row">
          <strong class="test-panel-name">Health Check</strong>
          <button class="test-btn" onclick="runTest('/health','t-health')">Run</button>
        </div>
        <div class="test-result" id="t-health"></div>
      </div>
      <div class="test-panel">
        <div class="test-panel-row">
          <strong class="test-panel-name">Portfolio</strong>
          <button class="test-btn" onclick="runTest('/api/portfolio','t-portfolio')">Run</button>
        </div>
        <div class="test-result" id="t-portfolio"></div>
      </div>
      <div class="test-panel">
        <div class="test-panel-row">
          <strong class="test-panel-name">Market Regime</strong>
          <button class="test-btn" onclick="runTest('/api/regime','t-regime')">Run</button>
        </div>
        <div class="test-result" id="t-regime"></div>
      </div>
      <div class="test-panel">
        <div class="test-panel-row">
          <strong class="test-panel-name">Quote (AAPL)</strong>
          <button class="test-btn" onclick="runTest('/api/quote?symbol=AAPL','t-quote')">Run</button>
        </div>
        <div class="test-result" id="t-quote"></div>
      </div>
      <div class="test-panel">
        <div class="test-panel-row">
          <strong class="test-panel-name">Crypto</strong>
          <button class="test-btn" onclick="runTest('/api/crypto','t-crypto')">Run</button>
        </div>
        <div class="test-result" id="t-crypto"></div>
      </div>
      <div class="test-panel">
        <div class="test-panel-row">
          <strong class="test-panel-name">Signals</strong>
          <button class="test-btn" onclick="runTest('/api/signals?limit=5','t-signals')">Run</button>
        </div>
        <div class="test-result" id="t-signals"></div>
      </div>
    </div>
  </div>

  <!-- ═══ CONFIG ═══ -->
  <div class="section">
    <div class="section-hdr">⚙️ Runtime Configuration</div>
    <div class="card" id="config-panel" style="font-family:'Roboto Mono',monospace;font-size:11px;white-space:pre-wrap;color:var(--c-on-surface-2)">Loading...</div>
  </div>

  <!-- ═══════════════════════════════════════════════════════ -->
  <!-- v3.1: WIN/LOSS TELEGRAM ALERTS TABLE                    -->
  <!-- ═══════════════════════════════════════════════════════ -->
  <div class="section" id="wl-section">
    <div class="section-hdr">🏆 Recommendation Tracker — Intelligence P&L</div>
    <div class="card">
      <!-- Stats Row -->
      <div class="wl-stats-row" id="wl-stats-row">
        <div class="wl-stat"><div class="label">Total Alerts</div><div class="val" id="wl-total">—</div></div>
        <div class="wl-stat"><div class="label">Wins</div><div class="val up" id="wl-wins">—</div></div>
        <div class="wl-stat"><div class="label">Losses</div><div class="val down" id="wl-losses">—</div></div>
        <div class="wl-stat"><div class="label">Win Rate</div><div class="val" id="wl-winrate">—</div></div>
        <div class="wl-stat"><div class="label">Total P&L</div><div class="val" id="wl-pnl">—</div></div>
        <div class="wl-stat"><div class="label">Profit Factor</div><div class="val" id="wl-pf">—</div></div>
        <div class="wl-stat"><div class="label">Avg Win</div><div class="val up" id="wl-avgwin">—</div></div>
        <div class="wl-stat"><div class="label">Avg Loss</div><div class="val down" id="wl-avgloss">—</div></div>
        <div class="wl-stat"><div class="label">Expectancy</div><div class="val" id="wl-expect">—</div></div>
      </div>
      <!-- Engine Accuracy -->
      <div id="wl-engine-acc" class="engine-acc-row"></div>
      <!-- Filters + Search -->
      <div class="wl-filters">
        <button class="wl-filter-btn active" onclick="filterWLAlerts('ALL')">All</button>
        <button class="wl-filter-btn" onclick="filterWLAlerts('PENDING')">⏳ Pending</button>
        <button class="wl-filter-btn" onclick="filterWLAlerts('WIN')">✅ Wins</button>
        <button class="wl-filter-btn" onclick="filterWLAlerts('LOSS')">❌ Losses</button>
        <button class="wl-filter-btn" onclick="filterWLAlerts('BREAKEVEN')">➖ Breakeven</button>
        <button class="wl-filter-btn" onclick="filterWLAlerts('EXPIRED')">⏰ Expired</button>
        <input class="wl-search" type="text" placeholder="🔍 Search symbol..." id="wl-search" oninput="applyWLFilters()">
      </div>
      <!-- Table -->
      <div style="overflow-x:auto">
        <table class="tbl" id="wl-table">
          <thead><tr>
            <th class="sortable" data-sort="sent_at" onclick="sortWLTable(this)">Date</th>
            <th class="sortable" data-sort="symbol" onclick="sortWLTable(this)">Symbol</th>
            <th>Action</th>
            <th class="sortable" data-sort="engine_id" onclick="sortWLTable(this)">Engine</th>
            <th>Entry</th><th>SL</th><th>TP1</th>
            <th>R:R</th>
            <th class="sortable" data-sort="confidence" onclick="sortWLTable(this)">Conf</th>
            <th class="sortable" data-sort="age" onclick="sortWLTable(this)">Age</th>
            <th>Outcome</th>
            <th class="sortable" data-sort="outcome_pnl_pct" onclick="sortWLTable(this)">P&L</th>
          </tr></thead>
          <tbody id="wl-body"><tr><td colspan="12" class="loading">Loading alerts...</td></tr></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- ═══════════════════════════════════════════════════════ -->
  <!-- v3.1: P&L ANALYTICS DASHBOARD                          -->
  <!-- ═══════════════════════════════════════════════════════ -->
  <div class="section" id="pnl-section">
    <div class="section-hdr">📊 P&L Analytics Dashboard <span style="font-size:11px;padding:2px 10px;border-radius:10px;background:rgba(49,141,255,.15);color:#319dff;margin-left:8px;vertical-align:middle;letter-spacing:.5px">PAPER TRADING</span></div>

    <!-- P&L Hero Metrics -->
    <div class="pnl-hero" id="pnl-hero">
      <div class="card"><div class="card-title">Portfolio P&L</div><div class="card-value" id="pnl-cumulative">—</div><div class="card-sub" id="pnl-cumulative-sub">Realized + Unrealized</div></div>
      <div class="card"><div class="card-title">Realized</div><div class="card-value" id="pnl-realized">—</div><div class="card-sub" id="pnl-realized-sub">Closed trades</div></div>
      <div class="card"><div class="card-title">Unrealized</div><div class="card-value" id="pnl-unrealized">—</div><div class="card-sub" id="pnl-unrealized-sub">Open positions</div></div>
      <div class="card"><div class="card-title">Win Rate</div><div class="card-value" id="pnl-winrate">—</div><div class="card-sub" id="pnl-winrate-sub">Closed trades</div></div>
      <div class="card"><div class="card-title">Max Drawdown</div><div class="card-value down" id="pnl-max-dd">—</div><div class="card-sub">Peak-to-trough</div></div>
      <div class="card"><div class="card-title">Current Streak</div><div id="pnl-streak" class="card-value">—</div><div class="card-sub" id="pnl-streak-sub">—</div></div>
    </div>

    <!-- Tab Navigation -->
    <div class="tab-bar">
      <button class="tab-btn active" onclick="switchPnlTab('equity', this)">📈 Equity Curve</button>
      <button class="tab-btn" onclick="switchPnlTab('drawdown', this)">📉 Drawdown</button>
      <button class="tab-btn" onclick="switchPnlTab('monthly', this)">📅 Monthly Returns</button>
      <button class="tab-btn" onclick="switchPnlTab('daily', this)">📊 Daily P&L</button>
      <button class="tab-btn" onclick="switchPnlTab('breakdown', this)">🔍 Breakdown</button>
      <button class="tab-btn" onclick="switchPnlTab('simtrades', this)">📋 Trades</button>
    </div>

    <!-- Tab: Equity Curve -->
    <div class="tab-content active" id="tab-equity">
      <div class="card">
        <div class="card-title">Equity Curve</div>
        <div class="pnl-chart-container"><canvas id="equity-canvas"></canvas></div>
      </div>
    </div>

    <!-- Tab: Drawdown -->
    <div class="tab-content" id="tab-drawdown">
      <div class="card">
        <div class="card-title">Drawdown from Peak</div>
        <div class="pnl-chart-container"><canvas id="drawdown-canvas"></canvas></div>
      </div>
    </div>

    <!-- Tab: Monthly Returns Heatmap -->
    <div class="tab-content" id="tab-monthly">
      <div class="card">
        <div class="card-title">Monthly Returns Heatmap</div>
        <div class="pnl-monthly-grid" id="pnl-monthly-grid"></div>
      </div>
    </div>

    <!-- Tab: Daily P&L Bars -->
    <div class="tab-content" id="tab-daily">
      <div class="card">
        <div class="card-title">Daily P&L (Last 60 Days)</div>
        <div class="pnl-bar-chart" id="pnl-daily-bars"></div>
      </div>
    </div>

    <!-- Tab: Breakdown by Engine & Symbol -->
    <div class="tab-content" id="tab-breakdown">
      <div class="pnl-breakdown-grid">
        <div class="card">
          <div class="card-title">P&L by Engine</div>
          <table class="tbl" id="pnl-engine-table">
            <thead><tr><th>Engine</th><th>Trades</th><th>Win Rate</th><th>P&L</th></tr></thead>
            <tbody id="pnl-engine-body"><tr><td colspan="4" class="loading">Loading...</td></tr></tbody>
          </table>
        </div>
        <div class="card">
          <div class="card-title">P&L by Symbol (Top 20)</div>
          <table class="tbl" id="pnl-symbol-table">
            <thead><tr><th>Symbol</th><th>Trades</th><th>Win Rate</th><th>P&L</th></tr></thead>
            <tbody id="pnl-symbol-body"><tr><td colspan="4" class="loading">Loading...</td></tr></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Tab: Simulated Trades Detail -->
    <div class="tab-content" id="tab-simtrades">
      <div class="card" style="padding:0;overflow-x:auto">
        <div class="sim-trades-header">
          <div class="card-title" style="margin:0">Simulated Trades <span class="sim-trades-desc">$100K virtual capital · 2% risk per trade</span></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap" id="sim-trade-filters">
            <button class="chip active" onclick="filterSimTrades('all',this)">All</button>
            <button class="chip" onclick="filterSimTrades('OPEN',this)">🟢 Open</button>
            <button class="chip" onclick="filterSimTrades('CLOSED',this)">⚪ Closed</button>
          </div>
        </div>
        <table class="tbl" id="sim-trades-table">
          <thead><tr>
            <th>Date</th><th>Symbol</th><th>Side</th><th>Engine</th><th>Qty</th>
            <th>Entry</th><th>SL</th><th>TP</th><th>Exit / Current</th>
            <th>P&L $</th><th>P&L %</th><th>Status</th><th>Age</th>
          </tr></thead>
          <tbody id="sim-trades-body"><tr><td colspan="13" class="loading">Loading...</td></tr></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- ═══ ALERT DETAIL MODAL ═══ -->
  <div class="modal-overlay" id="alert-modal" onclick="if(event.target===this)closeAlertModal()">
    <div class="modal">
      <div class="modal-header">
        <h2 id="modal-title">Alert Detail</h2>
        <button class="modal-close" onclick="closeAlertModal()">&times;</button>
      </div>
      <div class="modal-body" id="modal-body">
        <div class="loading">Loading...</div>
      </div>
    </div>
  </div>

</div>

<div class="refresh-bar"><div class="refresh-bar-fill" id="refresh-bar"></div></div>
`;
