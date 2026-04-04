// ─── Dashboard Client JS — Core helpers + main render functions ───
// Embedded as inline <script> in the dashboard HTML

export const CLIENT_CORE_JS = `
// ─── Helpers ─────────────────────────────────────
function $(id) { return document.getElementById(id); }
function fmt(n, d) { return n != null ? Number(n).toFixed(d ?? 2) : '—'; }
function fmtUsd(n) { return n != null ? '$' + Number(n).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}) : '—'; }
function fmtPct(n) { return n != null ? (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%' : '—'; }
function pnlClass(n) { return n > 0 ? 'up' : n < 0 ? 'down' : ''; }
function ts(epoch) { if (!epoch) return '—'; const d = new Date(epoch); return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}); }
function safeFetch(path) { return fetch(BASE + path, {credentials:'include'}).then(r => r.ok ? r.json() : null).catch(() => null); }

// ─── Main Load ───────────────────────────────────
async function loadDashboard() {
  const [status, portfolio, regime, signals, trades, riskEvents, positions, news, performance, dailyPnl, engineStats, dashData, rssFeed, socialSentiment, tvSnapshots, feedHealth] = await Promise.all([
    safeFetch('/api/system-status'),
    safeFetch('/api/portfolio'),
    safeFetch('/api/regime'),
    safeFetch('/api/signals?limit=30'),
    safeFetch('/api/trades?limit=15'),
    safeFetch('/api/risk-events'),
    safeFetch('/api/positions'),
    safeFetch('/api/news?limit=30'),
    safeFetch('/api/performance'),
    safeFetch('/api/daily-pnl?days=14'),
    safeFetch('/api/engine-stats'),
    safeFetch('/api/dashboard-data'),
    safeFetch('/api/rss-feed?hours=24&limit=50'),
    safeFetch('/api/social-sentiment?limit=30'),
    safeFetch('/api/tv-snapshots'),
    safeFetch('/api/feed-health'),
  ]);

  if (status) renderStatus(status, engineStats);
  renderPortfolio(portfolio, performance);
  renderRegime(regime);
  renderSignals(signals);
  renderTrades(trades);
  renderRiskEvents(riskEvents);
  renderPositions(positions);
  renderNews(news);
  renderRSSFeed(rssFeed);
  renderSentiment(socialSentiment);
  renderTVScanner(tvSnapshots);
  renderFeedHealth(feedHealth);
  renderSparkline(dailyPnl);
  renderWinLossTable(dashData?.tgAlerts, dashData?.tgStats);
  renderPnlDashboard(dashData?.pnlDash, dashData?.simTrades);
  renderSimTrades(dashData?.simTrades);
  $('last-update').textContent = 'Updated: ' + new Date().toLocaleTimeString();
}

// ─── System Status ───────────────────────────────
function renderStatus(d, engineStats) {
  // Health
  const h = $('h-health');
  h.textContent = d.health === 'ok' ? 'HEALTHY' : 'DEGRADED';
  h.className = 'card-value ' + (d.health === 'ok' ? 'up' : 'down');

  // Mode badge
  const mb = $('mode-badge');
  mb.textContent = d.mode;
  if (d.mode.includes('PAPER')) { mb.className = 'mode-badge paper'; }
  else if (d.mode.includes('LIVE')) { mb.className = 'mode-badge live'; }
  else { mb.className = 'mode-badge signals'; }

  // Health sub
  const setCount = Object.values(d.secrets).filter(Boolean).length;
  const total = Object.keys(d.secrets).length;
  $('h-health-sub').textContent = setCount + '/' + total + ' secrets · ' + d.crons.length + ' crons · ' + d.endpoints.length + ' endpoints';

  // Engines — merge static config with live D1 stats
  const statsMap = {};
  if (engineStats && engineStats.engines) {
    engineStats.engines.forEach(s => { statsMap[s.engine_id] = s; });
  }
  const eg = $('engine-grid');
  eg.innerHTML = d.engines.map(e => {
    const s = statsMap[e.id];
    const wr = s ? (s.win_rate * 100).toFixed(0) + '%' : '—';
    const pnl = s ? (s.pnl >= 0 ? '+' : '') + '$' + Number(s.pnl).toFixed(0) : '—';
    const trades = s ? s.trades_executed : 0;
    const sigs = s ? s.signals_generated : 0;
    const pnlColor = s ? (s.pnl >= 0 ? 'var(--c-buy)' : 'var(--c-sell)') : 'var(--c-on-surface-2)';
    return '<div class="engine-card">' +
      '<div class="name">' + e.name + '</div>' +
      '<div class="eid">' + e.id + '</div>' +
      '<div class="stats">' +
        '<span>Win Rate<div class="val">' + wr + '</div></span>' +
        '<span>P&L<div class="val" style="color:' + pnlColor + '">' + pnl + '</div></span>' +
        '<span>Trades<div class="val">' + trades + '</div></span>' +
        '<span>Signals<div class="val">' + sigs + '</div></span>' +
      '</div>' +
      '<div class="weight-bar"><div class="weight-bar-fill" style="width:' + e.weight + '%"></div></div>' +
      '<div style="text-align:right;font-size:9px;color:var(--c-on-surface-2);margin-top:2px">Weight: ' + e.weight + '%' + (s ? ' · ' + s.date : '') + '</div>' +
    '</div>';
  }).join('');

  // Crons
  const ct = document.querySelector('#cron-table tbody');
  ct.innerHTML = d.crons.map(c => '<tr>' +
    '<td style="font-weight:500;font-size:12px">' + c.name + '</td>' +
    '<td><span class="cron-expr">' + c.schedule + '</span></td>' +
    '<td style="color:var(--c-on-surface-2);font-size:12px">' + c.description + '</td>' +
  '</tr>').join('');

  // APIs
  const ag = $('api-grid');
  ag.innerHTML = Object.values(d.apis).map(a => {
    const dot = a.status === 'missing-key' ? 'err' : 'ok';
    return '<div class="api-item">' +
      '<div class="api-dot ' + dot + '"></div>' +
      '<div><div style="font-size:12px;font-weight:500">' + a.name + '</div><div style="font-size:10px;color:var(--c-on-surface-2)">' + (a.keyRequired ? '🔑' : '🆓') + ' ' + a.status + '</div></div>' +
    '</div>';
  }).join('');

  // Secrets
  $('secrets-grid').innerHTML = Object.entries(d.secrets).map(function(e) {
    return '<div class="chip ' + (e[1]?'set':'unset') + '">' + (e[1]?'✓':'✗') + ' ' + e[0] + '</div>';
  }).join('');

  // Risk limits
  const rl = {maxDailyDrawdown:'Max Daily DD',killSwitch:'Kill Switch',maxPositionSize:'Position Size',maxSectorExposure:'Sector Exp.',maxTotalExposure:'Total Exp.',maxOpenPositions:'Open Positions',dailyLossLimit:'Daily Loss Limit',maxCorrelation:'Max Corr.'};
  $('risk-grid').innerHTML = Object.entries(d.riskLimits).map(function(e) {
    var k = e[0], v = e[1];
    var u = k.includes('Limit') ? fmtUsd(v) : k === 'maxCorrelation' ? v : k === 'maxOpenPositions' ? v : v+'%';
    return '<div class="risk-item"><span class="risk-label">' + (rl[k]||k) + '</span><span class="risk-value">' + u + '</span></div>';
  }).join('');

  // Endpoints
  $('ep-count').textContent = d.endpoints.length;
  $('endpoint-list').innerHTML = d.endpoints.map(function(e) {
    var parts = e.split(' ');
    var m = parts[0], p = parts[1];
    return '<div class="endpoint" onclick="runTest(\\'' + p.split('?')[0] + '\\',\\'t-health\\')"><span class="method">' + m + '</span> ' + p + '</div>';
  }).join('');

  // Config
  $('config-panel').textContent = JSON.stringify(d.config, null, 2);
}

// ─── Portfolio ───────────────────────────────────
function renderPortfolio(p, perf) {
  if (!p) {
    $('h-equity').textContent = '—';
    $('h-equity').className = 'card-value';
    $('h-cash').textContent = '—';
    $('h-daily-pnl').textContent = '—';
    $('h-daily-pnl').className = 'card-value';
    $('h-unrealized').textContent = '—';
    $('h-unrealized').className = 'card-value';
    $('h-cash-sub').textContent = 'Broker not connected';
    $('h-daily-pnl-sub').textContent = 'Connect Alpaca to see P&L';
    if (perf && perf.totalTrades > 0) {
      $('h-winrate').textContent = fmt(perf.winRate * 100, 1) + '%';
      $('h-winrate').className = 'card-value ' + (perf.winRate > 0.5 ? 'up' : perf.winRate < 0.4 ? 'down' : '');
    } else {
      $('h-winrate').textContent = perf ? '0%' : '—';
      $('h-winrate').className = 'card-value';
    }
    return;
  }
  $('h-equity').textContent = fmtUsd(p.equity || p.total_equity);
  $('h-equity').className = 'card-value';

  $('h-cash').textContent = fmtUsd(p.cash || p.buying_power);
  $('h-cash-sub').textContent = p.buying_power ? 'BP: ' + fmtUsd(p.buying_power) : 'Available';

  var dpnl = p.daily_pnl != null ? p.daily_pnl : (p.dailyPnl != null ? p.dailyPnl : 0);
  $('h-daily-pnl').textContent = fmtUsd(dpnl);
  $('h-daily-pnl').className = 'card-value ' + pnlClass(dpnl);
  var rpnl = p.realizedPnlToday != null ? p.realizedPnlToday : (p.realized_pnl_today != null ? p.realized_pnl_today : 0);
  var dpnlSub = fmtPct(p.daily_pnl_pct != null ? p.daily_pnl_pct : p.dailyPnlPct) + ' today';
  $('h-daily-pnl-sub').textContent = rpnl !== 0 ? dpnlSub + ' (realized: ' + fmtUsd(rpnl) + ')' : dpnlSub;

  var upnl = p.unrealized_pnl != null ? p.unrealized_pnl : (p.unrealizedPnl != null ? p.unrealizedPnl : (p.totalUnrealizedPnl != null ? p.totalUnrealizedPnl : 0));
  $('h-unrealized').textContent = fmtUsd(upnl);
  $('h-unrealized').className = 'card-value ' + pnlClass(upnl);

  var wr = p.win_rate != null ? p.win_rate : (p.winRate != null ? p.winRate : (perf ? perf.winRate : null));
  $('h-winrate').textContent = wr != null ? fmt(wr * 100, 1) + '%' : '—';
  $('h-winrate').className = 'card-value ' + (wr > 0.5 ? 'up' : wr < 0.4 ? 'down' : '');
}

// ─── Regime ──────────────────────────────────────
function renderRegime(r) {
  if (!r) {
    $('regime-badge').textContent = 'UNKNOWN';
    return;
  }
  var regime = r.regime || r.current || 'UNKNOWN';
  var rb = $('regime-badge');
  rb.textContent = regime.replace(/_/g, ' ');
  var cls = regime.includes('UP') ? 'up' : regime.includes('DOWN') ? 'down' : regime.includes('VOLATILE') ? 'volatile' : 'range';
  rb.className = 'regime-badge ' + cls;

  $('regime-vix').textContent = fmt(r.vix != null ? r.vix : r.vix_level, 1);
  $('regime-adx').textContent = fmt(r.adx, 1);
  $('regime-conf').textContent = r.confidence != null ? fmt(r.confidence, 0) + '%' : '—';

  if (r.suggestedEngines && r.suggestedEngines.length) {
    $('regime-weights').innerHTML = '<span style="color:var(--c-on-surface-2);font-size:11px">Suggested: </span>' + r.suggestedEngines.map(function(e) {
      return '<span class="mono" style="margin-right:8px;padding:2px 8px;background:var(--c-surface-2);border-radius:4px;font-size:11px">' + e + '</span>';
    }).join('');
  } else if (r.weights || r.engineWeights) {
    var w = r.weights || r.engineWeights;
    $('regime-weights').innerHTML = Object.entries(w).map(function(e) {
      return '<span class="mono" style="margin-right:12px">' + e[0] + ': <strong>' + (typeof e[1] === 'number' ? e[1]+'%' : e[1]) + '</strong></span>';
    }).join('');
  }
}

// ─── Positions ───────────────────────────────────
function renderPositions(data) {
  var pos = data && data.positions ? data.positions : [];
  $('pos-count').textContent = pos.length ? '(' + pos.length + ')' : '(0)';
  var body = $('positions-body');
  if (!pos.length) {
    body.innerHTML = '<tr><td colspan="8" class="empty">No open positions</td></tr>';
    return;
  }
  body.innerHTML = pos.map(function(p) {
    var entry = p.avg_entry || p.avg_entry_price || p.cost_basis;
    var current = p.current_price || p.market_value;
    var pnl = p.unrealized_pnl != null ? p.unrealized_pnl : (p.unrealized_pl != null ? p.unrealized_pl : 0);
    var pnlPct = p.unrealized_pnl_pct != null ? p.unrealized_pnl_pct : (p.unrealized_plpc != null ? p.unrealized_plpc : (entry ? ((current/entry-1)*100) : 0));
    return '<tr>' +
      '<td class="mono" style="font-weight:500">' + p.symbol + '</td>' +
      '<td style="color:' + (p.side === 'long' || p.side === 'LONG' ? 'var(--c-buy)' : 'var(--c-sell)') + '">' + (p.side||'').toUpperCase() + '</td>' +
      '<td class="mono">' + (p.qty || p.quantity || '—') + '</td>' +
      '<td class="mono">' + fmtUsd(entry) + '</td>' +
      '<td class="mono">' + fmtUsd(current) + '</td>' +
      '<td class="mono" style="color:' + (pnl>=0?'var(--c-buy)':'var(--c-sell)') + '">' + fmtUsd(pnl) + '</td>' +
      '<td class="mono" style="color:' + (pnlPct>=0?'var(--c-buy)':'var(--c-sell)') + '">' + fmtPct(pnlPct) + '</td>' +
      '<td class="mono" style="font-size:10px">' + (p.engine_id || '—') + '</td>' +
    '</tr>';
  }).join('');
}

// ─── Signals ─────────────────────────────────────
function renderSignals(data) {
  var sigs = data && data.signals ? data.signals : [];
  $('sig-count').textContent = sigs.length ? '(' + sigs.length + ')' : '';
  var panel = $('signals-panel');
  if (!sigs.length) { panel.innerHTML = '<div class="empty">No signals yet</div>'; return; }
  panel.innerHTML = sigs.slice(0, 20).map(function(s) {
    return '<div class="signal-chip" style="margin-bottom:4px">' +
      '<span class="dir ' + s.direction + '">' + s.direction + '</span>' +
      '<span class="mono" style="font-weight:500">' + s.symbol + '</span>' +
      '<span style="color:var(--c-on-surface-2);font-size:11px">' + s.signal_type + ' · ' + s.engine_id + '</span>' +
      '<span class="mono" style="margin-left:auto;font-size:10px;color:var(--c-on-surface-2)">' + ts(s.created_at) + '</span>' +
    '</div>';
  }).join('');
}

// ─── Risk Events ─────────────────────────────────
function renderRiskEvents(data) {
  var events = data && data.events ? data.events : [];
  var panel = $('risk-events-panel');
  if (!events.length) { panel.innerHTML = '<div class="empty">No risk events — system operating normally</div>'; return; }
  panel.innerHTML = events.map(function(e) {
    return '<div class="risk-event ' + e.severity + '" style="margin-bottom:4px">' +
      '<span style="font-weight:500;min-width:70px">' + e.severity + '</span>' +
      '<span style="flex:1">' + e.description + '</span>' +
      '<span class="mono" style="font-size:10px;color:var(--c-on-surface-2)">' + ts(e.created_at) + '</span>' +
    '</div>';
  }).join('');
}

// ─── Trades ──────────────────────────────────────
function renderTrades(data) {
  var trades = data && data.trades ? data.trades : [];
  var body = $('trades-body');
  if (!trades.length) { body.innerHTML = '<tr><td colspan="10" class="empty">No trades recorded yet</td></tr>'; return; }
  body.innerHTML = trades.map(function(t) {
    var pnl = t.pnl != null ? t.pnl : 0;
    return '<tr>' +
      '<td class="mono" style="font-size:10px">' + (t.id||'').slice(0,12) + '...</td>' +
      '<td class="mono" style="font-weight:500">' + t.symbol + '</td>' +
      '<td style="color:' + (t.side==='BUY'?'var(--c-buy)':'var(--c-sell)') + '">' + t.side + '</td>' +
      '<td class="mono">' + t.qty + '</td>' +
      '<td class="mono">' + fmtUsd(t.entry_price) + '</td>' +
      '<td class="mono">' + (t.exit_price ? fmtUsd(t.exit_price) : '—') + '</td>' +
      '<td class="mono" style="color:' + (pnl>=0?'var(--c-buy)':'var(--c-sell)') + '">' + (t.pnl != null ? fmtUsd(pnl) : '—') + '</td>' +
      '<td>' + (t.status === 'OPEN' ? '🟢' : t.status === 'CLOSED' ? '⚪' : '🔴') + ' ' + t.status + '</td>' +
      '<td class="mono" style="font-size:10px">' + t.engine_id + '</td>' +
      '<td class="mono" style="font-size:10px">' + ts(t.opened_at) + '</td>' +
    '</tr>';
  }).join('');
}

// ─── News Feed ───────────────────────────────────
var FEED_COLORS = {
  'mega-tech':'#80CBC4','more-tech':'#80CBC4','banks':'#80CBC4','semis':'#FFB74D',
  'mna':'#CE93D8','short-squeeze':'#EF5350','fed-rates':'#42A5F5','earnings':'#66BB6A',
  'sec-13f':'#FFA726','crypto':'#AB47BC','buybacks':'#26A69A','crash-signals':'#F44336'
};
function renderNews(data) {
  var alerts = data && data.alerts ? data.alerts : [];
  var feeds = data && data.feeds ? data.feeds : [];
  $('news-count').textContent = alerts.length ? '(' + alerts.length + ')' : '';

  var panel = $('news-panel');
  if (!alerts.length) {
    panel.innerHTML = '<div class="empty">No news alerts yet — trigger a midday or overnight scan to populate</div>';
  } else {
    panel.innerHTML = alerts.map(function(a) {
      var color = FEED_COLORS[a.category] || 'var(--c-on-surface-2)';
      var ago = a.published_at ? ts(a.published_at) : (a.published ? new Date(a.published).toLocaleString() : '');
      var title = (a.title || '').replace(/<[^>]*>/g, '').slice(0, 100);
      var link = a.url || '#';
      return '<div style="display:flex;gap:8px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.04);font-size:12px;align-items:flex-start">' +
        '<span class="mono" style="min-width:80px;color:' + color + ';font-size:10px;padding-top:2px">' + a.category + '</span>' +
        '<div style="flex:1">' +
          '<a href="' + link + '" target="_blank" rel="noopener" style="color:var(--c-on-surface);text-decoration:none">' + title + '</a>' +
          '<div style="font-size:10px;color:var(--c-on-surface-2);margin-top:2px">' + ago + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // Feed categories
  var fc = $('news-feeds');
  if (feeds.length) {
    fc.innerHTML = feeds.map(function(f) {
      var color = FEED_COLORS[f.id] || 'var(--c-on-surface-2)';
      return '<span class="chip" style="border-color:' + color + ';color:' + color + ';font-size:10px;cursor:pointer" onclick="filterNews(\\'' + f.id + '\\')">' + f.name + '</span>';
    }).join('');
  }

  // Engine mapping
  var em = $('news-engine-map');
  if (feeds.length) {
    var engineMap = {};
    feeds.forEach(function(f) { f.engines.forEach(function(e) {
      if (!engineMap[e]) engineMap[e] = [];
      engineMap[e].push(f.name);
    }); });
    em.innerHTML = Object.entries(engineMap).map(function(e) {
      return '<div style="margin-bottom:4px"><span class="mono" style="color:var(--c-primary);font-weight:500">' + e[0] + '</span>: ' + e[1].join(', ') + '</div>';
    }).join('');
  }
}

async function refreshNews() {
  $('news-panel').innerHTML = '<div class="loading">Fetching fresh Google Alerts...</div>';
  var data = await safeFetch('/api/news?limit=30&fresh=true');
  renderNews(data);
}

async function filterNews(category) {
  $('news-panel').innerHTML = '<div class="loading">Loading ' + category + '...</div>';
  var data = await safeFetch('/api/news?limit=20&category=' + category);
  renderNews(data);
}

// ─── RSS Intelligence Feed ───────────────────────
var RSS_COLORS = {
  'mega-tech':'#80CBC4','finance':'#42A5F5','crypto':'#AB47BC','macro':'#FFB74D',
  'sec':'#FFA726','earnings':'#66BB6A','markets':'#CE93D8','commodities':'#EF5350',
  'etf':'#26A69A','forex':'#4DD0E1','biotech':'#FF7043','energy':'#8BC34A',
  'general':'#90A4AE'
};
function renderRSSFeed(data) {
  var items = data && data.items ? data.items : [];
  $('rss-count').textContent = items.length ? '(' + items.length + ')' : '';
  var panel = $('rss-panel');
  if (!items.length) {
    panel.innerHTML = '<div class="empty">No RSS items yet — data populates after superpower scan</div>';
    return;
  }
  panel.innerHTML = items.map(function(item) {
    var color = RSS_COLORS[item.category] || RSS_COLORS.general;
    var sentLabel = '';
    if (item.sentiment != null) {
      var sc = Number(item.sentiment);
      sentLabel = '<span style="font-size:9px;padding:1px 6px;border-radius:8px;margin-left:6px;' +
        (sc > 0.2 ? 'background:rgba(76,175,80,.15);color:#66BB6A' : sc < -0.2 ? 'background:rgba(244,67,54,.15);color:#EF5350' : 'background:rgba(255,255,255,.06);color:var(--c-on-surface-2)') + '">' +
        (sc > 0.2 ? '▲ Bullish' : sc < -0.2 ? '▼ Bearish' : '— Neutral') + '</span>';
    }
    var symbols = '';
    try { var syms = JSON.parse(item.symbols || '[]'); if (syms.length) symbols = ' <span class="mono" style="color:var(--c-primary);font-size:9px">' + syms.join(' ') + '</span>'; } catch(e) {}
    var ago = item.pub_date ? ts(item.pub_date) : '';
    var title = (item.title || '').replace(/<[^>]*>/g, '').slice(0, 120);
    return '<div style="display:flex;gap:8px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.04);font-size:12px;align-items:flex-start">' +
      '<span class="mono" style="min-width:70px;color:' + color + ';font-size:10px;padding-top:2px">' + (item.source || item.category) + '</span>' +
      '<div style="flex:1">' +
        '<a href="' + (item.link || '#') + '" target="_blank" rel="noopener" style="color:var(--c-on-surface);text-decoration:none">' + title + '</a>' +
        sentLabel + symbols +
        '<div style="font-size:10px;color:var(--c-on-surface-2);margin-top:2px">' + ago + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

async function refreshRSS() {
  $('rss-panel').innerHTML = '<div class="loading">Fetching RSS feeds...</div>';
  var data = await safeFetch('/api/rss-feed?hours=24&limit=50');
  renderRSSFeed(data);
}

// ─── Social Sentiment ────────────────────────────
function renderSentiment(data) {
  var items = data && data.sentiment ? data.sentiment : [];
  $('sentiment-count').textContent = items.length ? '(' + items.length + ')' : '';
  var body = $('sentiment-body');
  if (!items.length) {
    body.innerHTML = '<tr><td colspan="8" class="empty">No sentiment data yet — populates after superpower scan</td></tr>';
    return;
  }
  body.innerHTML = items.map(function(s) {
    var sc = Number(s.sentiment_score);
    var cls = sc > 0.2 ? 'up' : sc < -0.2 ? 'down' : '';
    var bar = '<div style="display:flex;gap:2px;height:10px;width:80px;border-radius:4px;overflow:hidden">' +
      '<div style="flex:' + s.bullish + ';background:var(--c-buy)"></div>' +
      '<div style="flex:' + s.bearish + ';background:var(--c-sell)"></div></div>';
    return '<tr>' +
      '<td class="mono" style="font-weight:600;color:var(--c-primary)">' + s.symbol + '</td>' +
      '<td class="' + cls + '" style="font-weight:600">' + (sc >= 0 ? '+' : '') + sc.toFixed(2) + '</td>' +
      '<td>' + bar + ' ' + s.bullish + '</td>' +
      '<td>' + s.bearish + '</td>' +
      '<td>' + fmt(s.total_messages, 0) + '</td>' +
      '<td>' + fmt(s.watchlist_count, 0) + '</td>' +
      '<td style="font-size:10px">' + (s.source || '—') + '</td>' +
      '<td style="font-size:10px">' + ts(s.recorded_at) + '</td>' +
    '</tr>';
  }).join('');
}

// ─── TradingView Scanner ─────────────────────────
var tvData = {};
function renderTVScanner(data) {
  tvData = data && data.scanTypes ? data.scanTypes : {};
  renderTVTab('top_gainers');
}
function switchTVTab(scanType, btn) {
  var tabs = document.querySelectorAll('#tv-tabs .tab-btn');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
  if (btn) btn.classList.add('active');
  renderTVTab(scanType);
}
function renderTVTab(scanType) {
  var items = tvData[scanType] || [];
  var body = $('tv-body');
  if (!items.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">No scanner data — populates after superpower scan</td></tr>';
    return;
  }
  body.innerHTML = items.map(function(s) {
    var chgCls = s.change_pct > 0 ? 'up' : s.change_pct < 0 ? 'down' : '';
    var rsiColor = s.rsi > 70 ? 'var(--c-sell)' : s.rsi < 30 ? 'var(--c-buy)' : 'var(--c-on-surface-2)';
    return '<tr>' +
      '<td class="mono" style="font-weight:600;color:var(--c-primary)">' + s.symbol + '</td>' +
      '<td>' + fmtUsd(s.close) + '</td>' +
      '<td class="' + chgCls + '">' + fmtPct(s.change_pct) + '</td>' +
      '<td class="mono">' + (s.volume ? Number(s.volume).toLocaleString() : '—') + '</td>' +
      '<td style="color:' + rsiColor + '">' + fmt(s.rsi, 1) + '</td>' +
      '<td style="font-size:10px">' + (s.sector || '—') + '</td>' +
    '</tr>';
  }).join('');
}

// ─── Feed Health ─────────────────────────────────
function renderFeedHealth(data) {
  var feeds = data && data.feeds ? data.feeds : [];
  $('feed-health-count').textContent = feeds.length ? '(' + feeds.length + ')' : '';
  var body = $('feed-health-body');
  if (!feeds.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty">No feed health data yet — populates after first scan cycle</td></tr>';
    return;
  }
  body.innerHTML = feeds.map(function(f) {
    var pct = f.total_fetches > 0 ? ((f.successful_fetches / f.total_fetches) * 100) : 0;
    var statusColor = f.consecutive_failures > 3 ? 'var(--c-sell)' : f.consecutive_failures > 0 ? 'var(--c-warning,#FFB74D)' : 'var(--c-buy)';
    var statusText = f.consecutive_failures > 3 ? '🔴 DOWN' : f.consecutive_failures > 0 ? '🟡 DEGRADED' : '🟢 HEALTHY';
    return '<tr>' +
      '<td class="mono" style="font-weight:500">' + f.source + '</td>' +
      '<td>' + f.total_fetches + '</td>' +
      '<td>' + f.successful_fetches + '</td>' +
      '<td style="color:' + (pct >= 90 ? 'var(--c-buy)' : pct >= 50 ? 'var(--c-warning,#FFB74D)' : 'var(--c-sell)') + '">' + pct.toFixed(0) + '%</td>' +
      '<td>' + fmt(f.avg_items_per_fetch, 1) + '</td>' +
      '<td style="color:' + (f.consecutive_failures > 0 ? 'var(--c-sell)' : 'var(--c-on-surface-2)') + '">' + f.consecutive_failures + '</td>' +
      '<td style="color:' + statusColor + ';font-weight:600;font-size:11px">' + statusText + '</td>' +
    '</tr>';
  }).join('');
}

// ─── P&L Sparkline ───────────────────────────────
function renderSparkline(data) {
  var panel = $('pnl-sparkline');
  var days = data && data.pnl ? data.pnl : [];
  if (!days.length) {
    panel.innerHTML = '<div class="empty">No P&L history yet — data populates after first trading day</div>';
    return;
  }
  var sorted = days.slice().sort(function(a, b) { return a.date.localeCompare(b.date); });
  var vals = sorted.map(function(d) { return d.daily_pnl; });
  var maxAbs = Math.max.apply(null, vals.map(Math.abs).concat([1]));
  var barH = 36;
  panel.innerHTML = sorted.map(function(d) {
    var v = d.daily_pnl;
    var h = Math.max(2, Math.abs(v) / maxAbs * barH);
    var color = v >= 0 ? 'var(--c-buy)' : 'var(--c-sell)';
    var pct = d.daily_pnl_pct != null ? fmtPct(d.daily_pnl_pct) : '';
    return '<div title="' + d.date + ': ' + fmtUsd(v) + ' (' + pct + ')" style="display:flex;flex-direction:column;align-items:flex-end;justify-content:flex-end;flex:1;min-width:0">' +
      '<div style="width:100%;max-width:24px;height:' + h + 'px;background:' + color + ';border-radius:2px 2px 0 0;opacity:.8"></div>' +
      '<div style="font-size:7px;color:var(--c-on-surface-2);text-align:center;white-space:nowrap;overflow:hidden">' + d.date.slice(5) + '</div>' +
    '</div>';
  }).join('');
}

// ─── Test Runner ─────────────────────────────────
async function runTest(path, targetId) {
  var el = $(targetId);
  el.style.display = 'block';
  el.textContent = 'Fetching ' + path + '...';
  try {
    var start = performance.now();
    var res = await fetch(BASE + path, {credentials:'include'});
    var ms = (performance.now() - start).toFixed(0);
    var data = await res.json();
    el.textContent = '[' + res.status + '] ' + ms + 'ms\\n' + JSON.stringify(data, null, 2).slice(0, 2000);
    el.style.color = res.ok ? 'var(--c-success)' : 'var(--c-error)';
  } catch (err) {
    el.textContent = 'ERROR: ' + err.message;
    el.style.color = 'var(--c-error)';
  }
}
`;
