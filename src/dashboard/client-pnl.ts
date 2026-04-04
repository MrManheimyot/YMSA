// ─── Dashboard Client JS — P&L analytics, SimTrades, Charts, Init ───

export const CLIENT_PNL_JS = `
// ═══════════════════════════════════════════════════════════
// P&L ANALYTICS DASHBOARD
// ═══════════════════════════════════════════════════════════

function switchPnlTab(tabId, btn) {
  document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.remove('active'); });
  btn.classList.add('active');
  $('tab-' + tabId).classList.add('active');
}

function renderPnlDashboard(data, simTrades) {
  if (!data) {
    $('pnl-cumulative').textContent = '—';
    return;
  }

  var dailyPnl = data.dailyPnl;
  var monthlyPnl = data.monthlyPnl;
  var equityCurve = data.equityCurve;
  var drawdownSeries = data.drawdownSeries;
  var tradesByEngine = data.tradesByEngine;
  var tradesBySymbol = data.tradesBySymbol;
  var streaks = data.streaks;
  var trades = Array.isArray(simTrades) ? simTrades : [];

  var closedTrades = trades.filter(function(t) { return t.status === 'CLOSED'; });
  var openTrades = trades.filter(function(t) { return t.status === 'OPEN'; });
  var realizedPnl = closedTrades.reduce(function(s, t) { return s + (t.pnl || 0); }, 0);
  var unrealizedPnl = openTrades.reduce(function(s, t) { return s + (t.pnl || 0); }, 0);
  var totalPnl = realizedPnl + unrealizedPnl;

  $('pnl-cumulative').textContent = fmtUsd(totalPnl);
  $('pnl-cumulative').className = 'card-value ' + pnlClass(totalPnl);
  var portfolioValue = 100000 + totalPnl;
  $('pnl-cumulative-sub').textContent = 'Portfolio: ' + fmtUsd(portfolioValue);

  $('pnl-realized').textContent = fmtUsd(realizedPnl);
  $('pnl-realized').className = 'card-value ' + pnlClass(realizedPnl);
  $('pnl-realized-sub').textContent = closedTrades.length + ' closed trade' + (closedTrades.length !== 1 ? 's' : '');

  $('pnl-unrealized').textContent = fmtUsd(unrealizedPnl);
  $('pnl-unrealized').className = 'card-value ' + pnlClass(unrealizedPnl);
  $('pnl-unrealized-sub').textContent = openTrades.length + ' open position' + (openTrades.length !== 1 ? 's' : '');

  var wins = closedTrades.filter(function(t) { return (t.pnl || 0) > 0; });
  var losses = closedTrades.filter(function(t) { return (t.pnl || 0) < 0; });
  if (closedTrades.length > 0) {
    var wr = (wins.length / closedTrades.length) * 100;
    $('pnl-winrate').textContent = fmt(wr, 0) + '%';
    $('pnl-winrate').className = 'card-value ' + (wr >= 50 ? 'up' : 'down');
    $('pnl-winrate-sub').textContent = wins.length + 'W / ' + losses.length + 'L';
  }

  if (drawdownSeries.length > 0) {
    var maxDd = Math.min.apply(null, drawdownSeries.map(function(d) { return d.drawdown_pct; }));
    $('pnl-max-dd').textContent = fmt(maxDd, 2) + '%';
  }

  if (streaks) {
    if (streaks.currentStreak > 0 && streaks.currentType !== 'NONE') {
      $('pnl-streak').textContent = streaks.currentStreak + ' ' + streaks.currentType;
      $('pnl-streak').className = 'card-value ' + (streaks.currentType === 'WIN' ? 'up' : 'down');
    } else {
      $('pnl-streak').textContent = '—';
    }
    $('pnl-streak-sub').textContent = 'Best: ' + streaks.longestWin + 'W / Worst: ' + streaks.longestLoss + 'L';
  }

  renderLineChart('equity-canvas', equityCurve.map(function(d) { return d.date; }), equityCurve.map(function(d) { return d.equity; }), 'var(--c-primary)', true);
  renderLineChart('drawdown-canvas', drawdownSeries.map(function(d) { return d.date; }), drawdownSeries.map(function(d) { return d.drawdown_pct; }), 'var(--c-sell)', false);

  // Monthly Returns Heatmap
  var grid = $('pnl-monthly-grid');
  if (monthlyPnl.length > 0) {
    grid.innerHTML = monthlyPnl.map(function(m) {
      var intensity = Math.min(Math.abs(m.pnl_pct) / 10, 1);
      var bg = m.pnl >= 0
        ? 'rgba(63,185,80,' + (0.1 + intensity * 0.4) + ')'
        : 'rgba(248,81,73,' + (0.1 + intensity * 0.4) + ')';
      var color = m.pnl >= 0 ? 'var(--c-buy)' : 'var(--c-sell)';
      return '<div class="pnl-month-cell" style="background:' + bg + ';color:' + color + '" title="' + m.month + ': ' + fmtUsd(m.pnl) + ' (' + fmtPct(m.pnl_pct) + ') - ' + m.trades + ' trades, ' + fmt(m.win_rate*100,0) + '% WR">' +
        '<span class="month-label">' + m.month + '</span>' +
        fmtPct(m.pnl_pct) +
      '</div>';
    }).join('');
  } else {
    grid.innerHTML = '<div class="empty" style="grid-column:span 6">No monthly data yet</div>';
  }

  // Daily P&L Bars
  var bars = $('pnl-daily-bars');
  var recent60 = dailyPnl.slice(-60);
  if (recent60.length > 0) {
    var maxAbs = Math.max.apply(null, recent60.map(function(d) { return Math.abs(d.daily_pnl); }).concat([1]));
    var barH = 100;
    bars.innerHTML = recent60.map(function(d) {
      var v = d.daily_pnl;
      var h = Math.max(2, Math.abs(v) / maxAbs * barH);
      var color = v >= 0 ? 'var(--c-buy)' : 'var(--c-sell)';
      return '<div class="pnl-bar" style="height:' + h + 'px;background:' + color + '" title="' + d.date + ': ' + fmtUsd(v) + ' (' + fmtPct(d.daily_pnl_pct) + ')">' +
        '<span class="bar-tip">' + d.date.slice(5) + ': ' + fmtUsd(v) + '</span>' +
      '</div>';
    }).join('');
  } else {
    bars.innerHTML = '<div class="empty" style="width:100%">No daily P&L data yet</div>';
  }

  renderBreakdownTable('pnl-engine-body', tradesByEngine, 'engine_id');
  renderBreakdownTable('pnl-symbol-body', tradesBySymbol, 'symbol');
}

function renderBreakdownTable(bodyId, data, nameKey) {
  var body = $(bodyId);
  if (!data || !data.length) {
    body.innerHTML = '<tr><td colspan="4" class="empty">No data yet</td></tr>';
    return;
  }
  body.innerHTML = data.map(function(row) {
    var pnl = row.pnl || 0;
    var wr = row.win_rate != null ? fmt(row.win_rate * 100, 0) + '%' : '—';
    return '<tr>' +
      '<td class="mono" style="font-weight:500;font-size:11px">' + row[nameKey] + '</td>' +
      '<td class="mono">' + row.count + '</td>' +
      '<td class="mono" style="color:' + ((row.win_rate||0) > 0.5 ? 'var(--c-buy)' : 'var(--c-sell)') + '">' + wr + '</td>' +
      '<td class="mono" style="color:' + (pnl >= 0 ? 'var(--c-buy)' : 'var(--c-sell)') + '">' + fmtUsd(pnl) + '</td>' +
    '</tr>';
  }).join('');
}

// ── Simulated Trades Table ──
var _simTradesData = [];
var _simTradeFilter = 'all';

function renderSimTrades(data) {
  _simTradesData = data || [];
  _renderSimTradesFiltered();
}

function filterSimTrades(filter, btn) {
  _simTradeFilter = filter;
  document.querySelectorAll('#sim-trade-filters .chip').forEach(function(c) { c.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  _renderSimTradesFiltered();
}

function _renderSimTradesFiltered() {
  var body = $('sim-trades-body');
  var trades = _simTradesData;
  if (_simTradeFilter !== 'all') {
    trades = trades.filter(function(t) { return t.status === _simTradeFilter; });
  }
  if (!trades.length) {
    body.innerHTML = '<tr><td colspan="13" class="empty">No simulated trades yet</td></tr>';
    return;
  }
  var now = Date.now();
  body.innerHTML = trades.map(function(t) {
    var pnl = t.pnl != null ? t.pnl : 0;
    var isBuy = t.side === 'BUY';
    var isOpen = t.status === 'OPEN';

    var displayPnl = '—';
    var displayPnlPct = '—';
    var pnlColor = 'var(--c-on-surface-2)';

    if (t.pnl != null) {
      displayPnl = fmtUsd(t.pnl);
      displayPnlPct = fmtPct(t.pnl_pct);
      pnlColor = t.pnl >= 0 ? 'var(--c-buy)' : 'var(--c-sell)';
    }

    var statusBadge;
    if (isOpen && t.pnl != null && t.pnl >= 0) {
      statusBadge = '<span style="color:var(--c-buy)">🟢 IN PROFIT</span>';
    } else if (isOpen && t.pnl != null && t.pnl < 0) {
      statusBadge = '<span style="color:var(--c-sell)">🔴 IN LOSS</span>';
    } else if (isOpen) {
      statusBadge = '<span style="color:var(--c-buy)">🟢 OPEN</span>';
    } else if (t.status === 'CLOSED' && pnl >= 0) {
      statusBadge = '<span style="color:var(--c-buy)">✅ WIN</span>';
    } else if (t.status === 'CLOSED' && pnl < 0) {
      statusBadge = '<span style="color:var(--c-sell)">❌ LOSS</span>';
    } else {
      statusBadge = '<span>⚪ ' + t.status + '</span>';
    }

    var ageMs = (t.closed_at || now) - t.opened_at;
    var ageDaysVal = Math.floor(ageMs / (24*60*60*1000));
    var ageHrs = Math.floor((ageMs % (24*60*60*1000)) / (60*60*1000));
    var ageLabel = ageDaysVal > 0 ? ageDaysVal + 'd ' + ageHrs + 'h' : ageHrs + 'h';

    var sideColor = isBuy ? 'var(--c-buy)' : 'var(--c-sell)';

    return '<tr>' +
      '<td class="mono" style="font-size:11px;white-space:nowrap">' + new Date(t.opened_at).toLocaleDateString() + ' ' + new Date(t.opened_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) + '</td>' +
      '<td class="mono" style="font-weight:600">' + t.symbol + '</td>' +
      '<td style="color:' + sideColor + ';font-weight:600">' + t.side + '</td>' +
      '<td class="mono" style="font-size:10px" title="' + t.engine_id + '">' + shortEngine(t.engine_id) + '</td>' +
      '<td class="mono">' + t.qty + '</td>' +
      '<td class="mono">' + fmtUsd(t.entry_price) + '</td>' +
      '<td class="mono" style="color:var(--c-sell)">' + (t.stop_loss ? fmtUsd(t.stop_loss) : '—') + '</td>' +
      '<td class="mono" style="color:var(--c-buy)">' + (t.take_profit ? fmtUsd(t.take_profit) : '—') + '</td>' +
      '<td class="mono">' + (t.exit_price ? fmtUsd(t.exit_price) : (isOpen && t.current_price ? '<i style="color:var(--c-on-surface-2)">' + fmtUsd(t.current_price) + '</i>' : '—')) + '</td>' +
      '<td class="mono" style="color:' + pnlColor + ';font-weight:500">' + displayPnl + '</td>' +
      '<td class="mono" style="color:' + pnlColor + '">' + displayPnlPct + '</td>' +
      '<td style="font-size:11px">' + statusBadge + '</td>' +
      '<td class="mono" style="font-size:11px">' + ageLabel + '</td>' +
    '</tr>';
  }).join('');

  var totalPnl = trades.reduce(function(s, t) { return s + (t.pnl || 0); }, 0);
  var openCount = trades.filter(function(t) { return t.status === 'OPEN'; }).length;
  var winsCount = trades.filter(function(t) { return t.status === 'CLOSED' && (t.pnl || 0) > 0; }).length;
  var lossCount = trades.filter(function(t) { return t.status === 'CLOSED' && (t.pnl || 0) < 0; }).length;
  var summaryColor = totalPnl >= 0 ? 'var(--c-buy)' : 'var(--c-sell)';
  body.innerHTML += '<tr style="border-top:2px solid rgba(255,255,255,.15);background:rgba(255,255,255,.03);font-weight:600">' +
    '<td colspan="5" style="text-align:right;font-size:11px;padding-right:8px">PORTFOLIO TOTAL — ' + trades.length + ' trades (' + openCount + ' open, ' + winsCount + 'W / ' + lossCount + 'L)</td>' +
    '<td colspan="4"></td>' +
    '<td class="mono" style="color:' + summaryColor + '">' + fmtUsd(totalPnl) + '</td>' +
    '<td colspan="3" class="mono" style="color:' + summaryColor + '">' + (totalPnl >= 0 ? '+' : '') + fmt(totalPnl / 1000, 2) + 'K</td>' +
  '</tr>';
}

// ── Canvas Line Chart (lightweight, no external libs) ──
function renderLineChart(canvasId, labels, values, color, fillBelow) {
  var canvas = $(canvasId);
  if (!canvas || !values.length) return;
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.scale(dpr, dpr);

  var W = rect.width;
  var H = rect.height;
  var pad = { top: 10, right: 10, bottom: 24, left: 60 };
  var cW = W - pad.left - pad.right;
  var cH = H - pad.top - pad.bottom;

  var minV = Math.min.apply(null, values);
  var maxV = Math.max.apply(null, values);
  var range = maxV - minV || 1;

  ctx.clearRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  ctx.lineWidth = 1;
  for (var i = 0; i <= 4; i++) {
    var y = pad.top + (cH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    var val = maxV - (range / 4) * i;
    ctx.fillStyle = 'rgba(255,255,255,.3)';
    ctx.font = '9px Roboto Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(val >= 1000 ? (val/1000).toFixed(1) + 'k' : val.toFixed(val < 10 ? 2 : 0), pad.left - 6, y + 3);
  }

  var step = Math.max(1, Math.floor(labels.length / 8));
  ctx.fillStyle = 'rgba(255,255,255,.3)';
  ctx.font = '8px Roboto Mono, monospace';
  ctx.textAlign = 'center';
  for (var j = 0; j < labels.length; j += step) {
    var lx = pad.left + (j / (labels.length - 1)) * cW;
    ctx.fillText(labels[j].slice(5), lx, H - 4);
  }

  ctx.beginPath();
  var resolvedColor = (color.startsWith('var(')
    ? getComputedStyle(document.documentElement).getPropertyValue(color.slice(4, -1).trim()).trim()
    : color) || '#80CBC4';
  for (var k = 0; k < values.length; k++) {
    var px = pad.left + (k / (values.length - 1)) * cW;
    var py = pad.top + cH - ((values[k] - minV) / range) * cH;
    if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = resolvedColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  if (fillBelow && values.length > 1) {
    var lastX = pad.left + cW;
    ctx.lineTo(lastX, pad.top + cH);
    ctx.lineTo(pad.left, pad.top + cH);
    ctx.closePath();
    var gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + cH);
    gradient.addColorStop(0, resolvedColor + '33');
    gradient.addColorStop(1, resolvedColor + '05');
    ctx.fillStyle = gradient;
    ctx.fill();
  }
}

// ─── Auto-refresh ────────────────────────────────
function tick() {
  countdown--;
  $('refresh-bar').style.width = ((countdown / REFRESH) * 100) + '%';
  if (countdown <= 0) { countdown = REFRESH; loadDashboard(); }
}

loadDashboard();
setInterval(tick, 1000);
`;
