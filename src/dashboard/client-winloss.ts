// ─── Dashboard Client JS — Win/Loss table + Alert Modal ───

export const CLIENT_WINLOSS_JS = `
// ═══════════════════════════════════════════════════════════
// WIN/LOSS TELEGRAM ALERT TABLE
// ═══════════════════════════════════════════════════════════

var allTgAlerts = [];
var allManualTrades = [];
var currentWLFilter = 'ALL';
var wlSortKey = 'sent_at';
var wlSortDir = 'desc';
var wlSearchQuery = '';

var ENGINE_NAMES = {
  'smart-money': 'SMC', 'fibonacci': 'FIB', 'stock-screener': 'SCR',
  'multi-timeframe': 'MTF', 'pairs-trading': 'PAIR', 'regime': 'REG',
  'crypto-dex': 'DEX', 'commodity': 'CMD', 'momentum': 'MOM',
  'Smart Money': 'SMAR', 'Event Driven': 'EVEN', 'Options': 'OPTI',
  'Momentum': 'MOM', 'Stock Screener': 'SCR', 'Fibonacci': 'FIB',
};

function shortEngine(engineId) {
  if (!engineId) return '—';
  return engineId.split('+').map(function(e) { return ENGINE_NAMES[e] || e.slice(0,4).toUpperCase(); }).join('+');
}

function calcRR(a) {
  if (!a.entry_price || a.entry_price === 0 || !a.stop_loss || !a.take_profit_1) return null;
  var risk = Math.abs(a.entry_price - a.stop_loss);
  var reward = Math.abs(a.take_profit_1 - a.entry_price);
  return risk > 0 ? reward / risk : null;
}

function ageDays(sentAt) {
  return Math.floor((Date.now() - sentAt) / (24*60*60*1000));
}

function renderWinLossTable(data, stats, simTrades) {
  allTgAlerts = Array.isArray(data) ? data : (data && data.alerts ? data.alerts : []);
  allManualTrades = (simTrades || []).filter(function(t) { return t.engine_id === 'MANUAL'; });
  if (stats) {
    $('wl-total').textContent = stats.total || '0';
    $('wl-wins').textContent = stats.wins || '0';
    $('wl-losses').textContent = stats.losses || '0';
    $('wl-winrate').textContent = stats.total > 0 ? fmt(stats.winRate * 100, 1) + '%' : '—';
    $('wl-winrate').className = 'val ' + (stats.winRate > 0.5 ? 'up' : stats.winRate < 0.4 ? 'down' : '');
    $('wl-pnl').textContent = fmtUsd(stats.totalPnl);
    $('wl-pnl').className = 'val ' + pnlClass(stats.totalPnl);
    $('wl-pf').textContent = stats.profitFactor === Infinity ? '∞' : fmt(stats.profitFactor, 2);
    $('wl-pf').className = 'val ' + (stats.profitFactor >= 1.5 ? 'up' : stats.profitFactor < 1 ? 'down' : '');
    $('wl-avgwin').textContent = stats.avgWinPnl ? fmtUsd(stats.avgWinPnl) : '—';
    $('wl-avgloss').textContent = stats.avgLossPnl ? '-' + fmtUsd(stats.avgLossPnl) : '—';
    $('wl-expect').textContent = stats.expectancy ? fmtUsd(stats.expectancy) : '—';
    $('wl-expect').className = 'val ' + pnlClass(stats.expectancy || 0);
    renderEngineAccuracy(stats.byEngine || []);
  }
  applyWLFilters();
  renderManualTrades();
}

function renderEngineAccuracy(engines) {
  var el = $('wl-engine-acc');
  if (!engines.length) { el.innerHTML = ''; return; }
  el.innerHTML = engines.map(function(e) {
    var wrPct = fmt(e.winRate * 100, 0);
    var barColor = e.winRate >= 0.6 ? 'var(--c-buy)' : e.winRate >= 0.4 ? 'var(--c-primary)' : 'var(--c-sell)';
    return '<div class="engine-acc-card">' +
      '<div class="eng-name">' + shortEngine(e.engine) + '</div>' +
      '<div class="eng-stats">' +
        '<span>' + e.total + ' alerts</span>' +
        '<span style="color:' + barColor + '">' + wrPct + '% WR</span>' +
        '<span class="' + pnlClass(e.pnl) + '">' + fmtUsd(e.pnl) + '</span>' +
      '</div>' +
      '<div class="engine-acc-bar"><div class="engine-acc-fill" style="width:' + wrPct + '%;background:' + barColor + '"></div></div>' +
    '</div>';
  }).join('');
}

function applyWLFilters() {
  var filtered = currentWLFilter === 'ALL' ? allTgAlerts.slice() : allTgAlerts.filter(function(a) { return a.outcome === currentWLFilter; });
  wlSearchQuery = ($('wl-search') ? $('wl-search').value : '').trim().toUpperCase();
  if (wlSearchQuery) {
    filtered = filtered.filter(function(a) { return a.symbol.toUpperCase().includes(wlSearchQuery) || (a.engine_id || '').toUpperCase().includes(wlSearchQuery); });
  }
  filtered.sort(function(a, b) {
    var va, vb;
    if (wlSortKey === 'age') { va = a.sent_at; vb = b.sent_at; }
    else if (wlSortKey === 'confidence') { va = a.confidence || 0; vb = b.confidence || 0; }
    else if (wlSortKey === 'outcome_pnl_pct') { va = a.outcome_pnl_pct || 0; vb = b.outcome_pnl_pct || 0; }
    else if (wlSortKey === 'symbol') { va = a.symbol; vb = b.symbol; }
    else if (wlSortKey === 'engine_id') { va = a.engine_id; vb = b.engine_id; }
    else { va = a.sent_at; vb = b.sent_at; }
    if (typeof va === 'string') return wlSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    return wlSortDir === 'asc' ? va - vb : vb - va;
  });
  renderWLRows(filtered);
}

function sortWLTable(th) {
  var key = th.dataset.sort;
  if (wlSortKey === key) { wlSortDir = wlSortDir === 'asc' ? 'desc' : 'asc'; }
  else { wlSortKey = key; wlSortDir = 'desc'; }
  document.querySelectorAll('#wl-table th.sortable').forEach(function(h) { h.classList.remove('asc','desc'); });
  th.classList.add(wlSortDir);
  applyWLFilters();
}

function filterWLAlerts(filter) {
  currentWLFilter = filter;
  document.querySelectorAll('.wl-filter-btn').forEach(function(b) { b.classList.remove('active'); });
  event.target.classList.add('active');
  applyWLFilters();
}

function renderWLRows(alerts) {
  var body = $('wl-body');
  if (!alerts.length) {
    body.innerHTML = '<tr><td colspan="13" class="empty">No alerts ' + (currentWLFilter !== 'ALL' ? 'with status ' + currentWLFilter : 'recorded yet') + '</td></tr>';
    return;
  }
  // Build map: alertId -> manual trade
  var mtMap = {};
  allManualTrades.forEach(function(t) { if (t.broker_order_id) mtMap[t.broker_order_id] = t; });

  body.innerHTML = alerts.map(function(a) {
    var pnl = a.outcome_pnl;
    var pnlPct = a.outcome_pnl_pct;
    var pnlColor = pnl > 0 ? 'var(--c-buy)' : pnl < 0 ? 'var(--c-sell)' : 'var(--c-on-surface-2)';
    var actionColor = a.action === 'BUY' ? 'var(--c-buy)' : 'var(--c-sell)';
    var rr = calcRR(a);
    var rrClass = rr >= 2 ? 'rr-good' : rr >= 1 ? 'rr-ok' : 'rr-bad';
    var conf = a.confidence || 0;
    var confColor = conf >= 80 ? 'var(--c-buy)' : conf >= 65 ? 'var(--c-primary)' : conf >= 50 ? '#ffc107' : 'var(--c-sell)';
    var age = ageDays(a.sent_at);
    var ageClass = age <= 1 ? 'fresh' : age <= 4 ? 'aging' : 'old';
    var pnlDisplay = pnl != null ? fmtUsd(pnl) + (pnlPct != null ? ' <span style="opacity:.6;font-size:9px">(' + (pnlPct >= 0 ? '+' : '') + fmt(pnlPct,1) + '%)</span>' : '') : '—';

    // Action buttons
    var mt = mtMap[a.id];
    var actionHtml;
    if (mt && mt.status === 'OPEN') {
      actionHtml = '<div class="wl-action-cell">' +
        '<button class="action-btn action-btn-close" onclick="event.stopPropagation();openCloseTradeForm(\\'' + mt.id + '\\')">💰 Close</button>' +
      '</div>';
    } else if (mt && mt.status === 'CLOSED') {
      actionHtml = '<span style="font-size:10px;color:var(--c-on-surface-2)">✅ Closed</span>';
    } else if (a.outcome === 'PENDING' && a.entry_price > 0) {
      actionHtml = '<div class="wl-action-cell">' +
        '<button class="action-btn action-btn-take" onclick="event.stopPropagation();openTakeTradeForm(\\'' + a.id + '\\')">✅ Take</button>' +
        '<button class="action-btn action-btn-skip" onclick="event.stopPropagation();skipAlert(\\'' + a.id + '\\')">⏭</button>' +
      '</div>';
    } else {
      actionHtml = '';
    }

    return '<tr class="wl-row" onclick="openAlertModal(\\'' + a.id + '\\')">' +
      '<td class="mono" style="font-size:10px">' + ts(a.sent_at) + '</td>' +
      '<td class="mono" style="font-weight:600">' + a.symbol + '</td>' +
      '<td style="color:' + actionColor + ';font-weight:600">' + a.action + '</td>' +
      '<td class="mono" style="font-size:10px" title="' + a.engine_id + '">' + shortEngine(a.engine_id) + '</td>' +
      '<td class="mono">' + (a.entry_price > 0 ? fmtUsd(a.entry_price) : '<span style="color:var(--c-sell)">N/A</span>') + '</td>' +
      '<td class="mono">' + (a.stop_loss ? fmtUsd(a.stop_loss) : '—') + '</td>' +
      '<td class="mono">' + (a.take_profit_1 ? fmtUsd(a.take_profit_1) : '—') + '</td>' +
      '<td>' + (rr != null ? '<span class="rr-pill ' + rrClass + '">' + fmt(rr,1) + ':1</span>' : '—') + '</td>' +
      '<td><div class="conf-bar"><div class="conf-fill" style="width:' + conf/2 + 'px;background:' + confColor + '"></div><span class="mono" style="font-size:10px">' + conf + '</span></div></td>' +
      '<td><span class="age-badge ' + ageClass + '">' + age + 'd</span></td>' +
      '<td><span class="wl-outcome ' + a.outcome + '">' + a.outcome + '</span></td>' +
      '<td class="mono" style="color:' + pnlColor + '">' + pnlDisplay + '</td>' +
      '<td onclick="event.stopPropagation()">' + actionHtml + '</td>' +
    '</tr>';
  }).join('');
}

// ─── Alert Detail Modal ──────────────────────────
async function openAlertModal(id) {
  var modal = $('alert-modal');
  modal.classList.add('active');
  $('modal-body').innerHTML = '<div class="loading">Loading alert details...</div>';
  $('modal-title').textContent = 'Alert Detail';

  var alert = await safeFetch('/api/telegram-alert?id=' + encodeURIComponent(id));
  if (!alert) {
    $('modal-body').innerHTML = '<div class="empty">Could not load alert</div>';
    return;
  }

  var actionColor = alert.action === 'BUY' ? 'var(--c-buy)' : 'var(--c-sell)';
  var pnlColor = alert.outcome_pnl > 0 ? 'var(--c-buy)' : alert.outcome_pnl < 0 ? 'var(--c-sell)' : 'var(--c-on-surface-2)';
  var outcomeClass = alert.outcome || 'PENDING';

  $('modal-title').innerHTML = '<span style="color:' + actionColor + '">' + alert.action + '</span> ' + alert.symbol + ' <span class="wl-outcome ' + outcomeClass + '" style="margin-left:8px">' + alert.outcome + '</span>';

  var metadata = {};
  try { metadata = JSON.parse(alert.metadata || '{}'); } catch(e) {}

  var rr = calcRR(alert);
  var age = ageDays(alert.sent_at);
  var risk = alert.entry_price && alert.stop_loss ? Math.abs(alert.entry_price - alert.stop_loss) : null;
  var reward = alert.entry_price && alert.take_profit_1 ? Math.abs(alert.take_profit_1 - alert.entry_price) : null;

  var metaEngines = metadata.engines || [];
  var metaReasons = metadata.reasons || [];
  var metaSignals = metadata.signals || [];
  var hasStructuredMeta = metaEngines.length || metaReasons.length || metaSignals.length;

  var html = '<div class="modal-section">' +
    '<div class="modal-section-title">📋 Trade Setup</div>' +
    '<div class="modal-kv">' +
      '<span class="k">Symbol</span><span class="v" style="font-weight:700">' + alert.symbol + '</span>' +
      '<span class="k">Action</span><span class="v" style="color:' + actionColor + '">' + alert.action + '</span>' +
      '<span class="k">Engine(s)</span><span class="v">' + shortEngine(alert.engine_id) + ' <span style="opacity:.5;font-size:9px">(' + alert.engine_id + ')</span></span>' +
      '<span class="k">Entry Price</span><span class="v">' + (alert.entry_price > 0 ? fmtUsd(alert.entry_price) : '<span style="color:var(--c-sell)">Missing</span>') + '</span>' +
      '<span class="k">Stop Loss</span><span class="v">' + (alert.stop_loss ? fmtUsd(alert.stop_loss) + (risk ? ' <span style="opacity:.5;font-size:9px">(risk: ' + fmtUsd(risk) + ')</span>' : '') : '—') + '</span>' +
      '<span class="k">Take Profit 1</span><span class="v">' + (alert.take_profit_1 ? fmtUsd(alert.take_profit_1) + (reward ? ' <span style="opacity:.5;font-size:9px">(reward: ' + fmtUsd(reward) + ')</span>' : '') : '—') + '</span>' +
      '<span class="k">Take Profit 2</span><span class="v">' + (alert.take_profit_2 ? fmtUsd(alert.take_profit_2) : '—') + '</span>' +
      '<span class="k">Confidence</span><span class="v">' + alert.confidence + '/100</span>' +
      '<span class="k">Risk : Reward</span><span class="v">' + (rr != null ? fmt(rr,2) + ':1' : '—') + '</span>' +
      '<span class="k">Regime</span><span class="v">' + (alert.regime || '—') + '</span>' +
      '<span class="k">Age</span><span class="v">' + age + ' day' + (age !== 1 ? 's' : '') + '</span>' +
      '<span class="k">Sent At</span><span class="v">' + ts(alert.sent_at) + '</span>' +
    '</div></div>';

  html += '<div class="modal-section">' +
    '<div class="modal-section-title">📊 Outcome</div>' +
    '<div class="modal-kv">' +
      '<span class="k">Status</span><span class="v"><span class="wl-outcome ' + outcomeClass + '">' + alert.outcome + '</span></span>' +
      '<span class="k">Outcome Price</span><span class="v">' + (alert.outcome_price ? fmtUsd(alert.outcome_price) : '—') + '</span>' +
      '<span class="k">P&L</span><span class="v" style="color:' + pnlColor + '">' + (alert.outcome_pnl != null ? fmtUsd(alert.outcome_pnl) : '—') + '</span>' +
      '<span class="k">P&L %</span><span class="v" style="color:' + pnlColor + '">' + (alert.outcome_pnl_pct != null ? fmtPct(alert.outcome_pnl_pct) : '—') + '</span>' +
      '<span class="k">Resolved At</span><span class="v">' + (alert.outcome_at ? ts(alert.outcome_at) : '—') + '</span>' +
      '<span class="k">Notes</span><span class="v" style="font-size:10px;text-align:left;grid-column:span 2">' + (alert.outcome_notes || '—') + '</span>' +
    '</div></div>';

  if (alert.outcome === 'PENDING') {
    html += '<div class="modal-section">' +
      '<div class="modal-section-title">✏️ Update Outcome</div>' +
      '<div class="modal-outcome-form" id="outcome-form">' +
        '<select id="outcome-select">' +
          '<option value="WIN">✅ Win</option>' +
          '<option value="LOSS">❌ Loss</option>' +
          '<option value="BREAKEVEN">➖ Breakeven</option>' +
          '<option value="EXPIRED">⏰ Expired</option>' +
        '</select>' +
        '<input type="number" id="outcome-price" placeholder="Exit Price" step="0.01" style="width:100px">' +
        '<input type="number" id="outcome-pnl" placeholder="P&L ($)" step="0.01" style="width:90px">' +
        '<input type="number" id="outcome-pnl-pct" placeholder="P&L %" step="0.01" style="width:80px">' +
        '<input type="text" id="outcome-notes" placeholder="Notes..." style="width:140px">' +
        '<button onclick="submitOutcome(\\'' + alert.id + '\\')">Save</button>' +
      '</div></div>';
  }

  if (hasStructuredMeta) {
    html += '<div class="modal-section"><div class="modal-section-title">🧠 Signal Intelligence</div>';
    if (metaEngines.length) {
      html += '<div style="margin-bottom:8px"><span style="font-size:10px;color:var(--c-on-surface-2);text-transform:uppercase;letter-spacing:.5px">Contributing Engines:</span><div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">' +
        metaEngines.map(function(e) { return '<span style="padding:2px 8px;border-radius:10px;font-size:10px;background:var(--c-primary-ctr);color:var(--c-primary)">' + shortEngine(e) + '</span>'; }).join('') + '</div></div>';
    }
    if (metaReasons.length) {
      html += '<div style="margin-bottom:8px"><span style="font-size:10px;color:var(--c-on-surface-2);text-transform:uppercase;letter-spacing:.5px">Reasons:</span><ul style="margin:4px 0 0 16px;font-size:11px;color:var(--c-on-surface)">' +
        metaReasons.map(function(r) { return '<li>' + String(r).replace(/</g,'&lt;') + '</li>'; }).join('') + '</ul></div>';
    }
    if (metaSignals.length) {
      html += '<div><span style="font-size:10px;color:var(--c-on-surface-2);text-transform:uppercase;letter-spacing:.5px">Signals:</span><div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">' +
        metaSignals.map(function(s) { return '<span style="padding:2px 8px;border-radius:10px;font-size:10px;background:var(--c-surface-2);color:var(--c-on-surface)">' + String(s).replace(/</g,'&lt;') + '</span>'; }).join('') + '</div></div>';
    }
    html += '</div>';
  } else if (metadata && Object.keys(metadata).length > 0) {
    html += '<div class="modal-section"><div class="modal-section-title">🔍 Signal Metadata</div>' +
      '<div style="font-family:\\'Roboto Mono\\',monospace;font-size:10px;background:var(--c-surface);border-radius:var(--radius-s);padding:10px;max-height:160px;overflow-y:auto;color:var(--c-on-surface-2)">' + JSON.stringify(metadata, null, 2) + '</div></div>';
  }

  html += '<div class="modal-section"><div class="modal-section-title">📨 Original Telegram Message</div>' +
    '<div class="modal-alert-text">' + (alert.alert_text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div></div>';

  $('modal-body').innerHTML = html;
}

function closeAlertModal() {
  $('alert-modal').classList.remove('active');
}

async function submitOutcome(id) {
  var outcome = $('outcome-select').value;
  var outcomePrice = parseFloat($('outcome-price').value) || null;
  var outcomePnl = parseFloat($('outcome-pnl').value) || null;
  var outcomePnlPct = parseFloat($('outcome-pnl-pct').value) || null;
  var outcomeNotes = $('outcome-notes').value || null;

  try {
    var res = await fetch(BASE + '/api/telegram-alert-outcome', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      credentials: 'include',
      body: JSON.stringify({ id: id, outcome: outcome, outcomePrice: outcomePrice, outcomePnl: outcomePnl, outcomePnlPct: outcomePnlPct, outcomeNotes: outcomeNotes })
    });
    if (res.ok) {
      closeAlertModal();
      loadDashboard();
    } else {
      window.alert('Failed to update: ' + (await res.text()));
    }
  } catch (err) {
    window.alert('Error: ' + err.message);
  }
}

document.addEventListener('keydown', function(e) { if (e.key === 'Escape') { closeAlertModal(); closeTakeTradeModal(); closeCloseTradeModal(); } });

// ═══════════════════════════════════════════════════════════
// MANUAL TRADE FUNCTIONS
// ═══════════════════════════════════════════════════════════

function openTakeTradeForm(alertId) {
  var alert = allTgAlerts.find(function(a) { return a.id === alertId; });
  if (!alert) return;
  $('ttm-alert-id').value = alertId;
  $('ttm-qty').value = '10';
  $('ttm-entry').value = '';
  $('ttm-entry').placeholder = alert.entry_price ? fmtUsd(alert.entry_price) : 'Alert price';
  $('ttm-status').textContent = '';
  $('ttm-info').innerHTML =
    '<div class="ttm-symbol">' + alert.symbol + ' <span style="font-size:14px;color:' + (alert.action === 'BUY' ? 'var(--c-buy)' : 'var(--c-sell)') + '">' + alert.action + '</span></div>' +
    '<div class="ttm-detail">Entry: ' + fmtUsd(alert.entry_price) + ' · SL: ' + (alert.stop_loss ? fmtUsd(alert.stop_loss) : '—') + ' · TP: ' + (alert.take_profit_1 ? fmtUsd(alert.take_profit_1) : '—') + '</div>' +
    '<div class="ttm-detail">Engine: ' + shortEngine(alert.engine_id) + ' · Confidence: ' + alert.confidence + '/100</div>';
  $('take-trade-modal').style.display = 'flex';
}

function closeTakeTradeModal() {
  $('take-trade-modal').style.display = 'none';
}

async function submitManualOpen() {
  var alertId = $('ttm-alert-id').value;
  var qty = parseInt($('ttm-qty').value) || 0;
  var actualEntry = parseFloat($('ttm-entry').value) || undefined;
  if (qty <= 0) { $('ttm-status').innerHTML = '<span style="color:var(--c-sell)">Enter a valid quantity</span>'; return; }
  $('ttm-status').innerHTML = '<span style="color:var(--c-primary)">Opening trade...</span>';
  try {
    var res = await fetch(BASE + '/api/manual-trade-open', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      credentials: 'include',
      body: JSON.stringify({ alertId: alertId, qty: qty, actualEntry: actualEntry })
    });
    var data = await res.json();
    if (res.ok && data.ok) {
      $('ttm-status').innerHTML = '<span style="color:var(--c-buy)">✅ Trade opened! Refreshing...</span>';
      setTimeout(function() { closeTakeTradeModal(); loadDashboard(); }, 800);
    } else {
      $('ttm-status').innerHTML = '<span style="color:var(--c-sell)">❌ ' + (data.error || 'Failed to open trade') + '</span>';
    }
  } catch (err) {
    $('ttm-status').innerHTML = '<span style="color:var(--c-sell)">❌ ' + err.message + '</span>';
  }
}

function openCloseTradeForm(tradeId) {
  var trade = allManualTrades.find(function(t) { return t.id === tradeId; });
  if (!trade) return;
  $('ctm-trade-id').value = tradeId;
  $('ctm-price').value = '';
  $('ctm-status').textContent = '';
  var meta = {};
  try { meta = JSON.parse(trade.trailing_state || '{}'); } catch(e) {}

  $('ctm-info').innerHTML =
    '<div class="ttm-symbol">' + trade.symbol + ' <span style="font-size:14px;color:' + (trade.side === 'BUY' ? 'var(--c-buy)' : 'var(--c-sell)') + '">' + trade.side + '</span></div>' +
    '<div class="ttm-detail">Entry: ' + fmtUsd(trade.entry_price) + ' · Qty: ' + trade.qty + ' · SL: ' + (trade.stop_loss ? fmtUsd(trade.stop_loss) : '—') + '</div>';

  // Quick exit buttons
  var btns = '';
  if (trade.take_profit) {
    btns += '<button class="ctm-quick-btn tp1" onclick="submitManualClose(\\'TP1\\', ' + trade.take_profit + ')"><span class="ctm-label">🎯 Hit TP1</span><span class="ctm-price">' + fmtUsd(trade.take_profit) + '</span></button>';
  }
  if (meta.take_profit_2) {
    btns += '<button class="ctm-quick-btn tp2" onclick="submitManualClose(\\'TP2\\', ' + meta.take_profit_2 + ')"><span class="ctm-label">🎯 Hit TP2</span><span class="ctm-price">' + fmtUsd(meta.take_profit_2) + '</span></button>';
  }
  if (trade.stop_loss) {
    btns += '<button class="ctm-quick-btn sl" onclick="submitManualClose(\\'SL\\', ' + trade.stop_loss + ')"><span class="ctm-label">🛑 Hit SL</span><span class="ctm-price">' + fmtUsd(trade.stop_loss) + '</span></button>';
  }
  $('ctm-quick-btns').innerHTML = btns;
  $('close-trade-modal').style.display = 'flex';
}

function closeCloseTradeModal() {
  $('close-trade-modal').style.display = 'none';
}

async function submitManualClose(exitType, price) {
  var tradeId = $('ctm-trade-id').value;
  var exitPrice = price || parseFloat($('ctm-price').value);
  if (!exitPrice || exitPrice <= 0) { $('ctm-status').innerHTML = '<span style="color:var(--c-sell)">Enter a valid exit price</span>'; return; }
  $('ctm-status').innerHTML = '<span style="color:var(--c-primary)">Closing trade...</span>';
  try {
    var res = await fetch(BASE + '/api/manual-trade-close', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      credentials: 'include',
      body: JSON.stringify({ tradeId: tradeId, exitPrice: exitPrice, exitType: exitType })
    });
    var data = await res.json();
    if (res.ok && data.ok) {
      var pnlMsg = data.pnl >= 0 ? '+' + fmtUsd(data.pnl) : fmtUsd(data.pnl);
      $('ctm-status').innerHTML = '<span style="color:' + (data.pnl >= 0 ? 'var(--c-buy)' : 'var(--c-sell)') + '">💰 Closed! P&L: ' + pnlMsg + '</span>';
      setTimeout(function() { closeCloseTradeModal(); loadDashboard(); }, 1200);
    } else {
      $('ctm-status').innerHTML = '<span style="color:var(--c-sell)">❌ ' + (data.error || 'Failed to close trade') + '</span>';
    }
  } catch (err) {
    $('ctm-status').innerHTML = '<span style="color:var(--c-sell)">❌ ' + err.message + '</span>';
  }
}

async function skipAlert(alertId) {
  if (!confirm('Skip this alert? It will be marked as EXPIRED.')) return;
  try {
    var res = await fetch(BASE + '/api/telegram-alert-outcome', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      credentials: 'include',
      body: JSON.stringify({ id: alertId, outcome: 'EXPIRED', outcomeNotes: 'Manually skipped' })
    });
    if (res.ok) loadDashboard();
  } catch (err) {
    window.alert('Error: ' + err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// MANUAL TRADES SECTION RENDERER
// ═══════════════════════════════════════════════════════════

function renderManualTrades() {
  var open = allManualTrades.filter(function(t) { return t.status === 'OPEN'; });
  var closed = allManualTrades.filter(function(t) { return t.status === 'CLOSED'; });
  var totalRealized = closed.reduce(function(s, t) { return s + (t.pnl || 0); }, 0);
  var wins = closed.filter(function(t) { return t.pnl > 0; }).length;

  $('mt-count').textContent = '(' + allManualTrades.length + ' total)';
  $('mt-open').textContent = open.length;
  $('mt-realized').textContent = fmtUsd(totalRealized);
  $('mt-realized').className = 'val ' + pnlClass(totalRealized);
  $('mt-unrealized').textContent = '—';
  $('mt-winrate').textContent = closed.length > 0 ? fmt(wins / closed.length * 100, 0) + '%' : '—';
  $('mt-total-pnl').textContent = fmtUsd(totalRealized);
  $('mt-total-pnl').className = 'val ' + pnlClass(totalRealized);

  var body = $('mt-body');
  if (!allManualTrades.length) {
    body.innerHTML = '<tr><td colspan="11" class="empty">No manual trades yet. Click "✅ Take" on any alert above to start tracking.</td></tr>';
    return;
  }

  // Show open first, then closed (most recent first)
  var sorted = open.concat(closed).sort(function(a, b) {
    if (a.status !== b.status) return a.status === 'OPEN' ? -1 : 1;
    return (b.opened_at || 0) - (a.opened_at || 0);
  });

  body.innerHTML = sorted.map(function(t) {
    var meta = {};
    try { meta = JSON.parse(t.trailing_state || '{}'); } catch(e) {}
    var pnl = t.pnl;
    var pnlColor = pnl > 0 ? 'var(--c-buy)' : pnl < 0 ? 'var(--c-sell)' : 'var(--c-on-surface-2)';
    var sideColor = t.side === 'BUY' ? 'var(--c-buy)' : 'var(--c-sell)';
    var statusClass = t.status === 'OPEN' ? 'PENDING' : (pnl > 0 ? 'WIN' : pnl < 0 ? 'LOSS' : 'BREAKEVEN');
    var tp = t.take_profit ? fmtUsd(t.take_profit) : '—';
    if (meta.take_profit_2) tp += ' / ' + fmtUsd(meta.take_profit_2);
    var exitOrCurrent = t.exit_price ? fmtUsd(t.exit_price) : '—';
    var closeBtn = t.status === 'OPEN'
      ? '<button class="action-btn action-btn-close" onclick="openCloseTradeForm(\\'' + t.id + '\\')">💰 Close</button>'
      : '<span style="font-size:10px;color:var(--c-on-surface-2)">' + (t.closed_at ? ts(t.closed_at) : '—') + '</span>';

    return '<tr>' +
      '<td class="mono" style="font-size:10px">' + ts(t.opened_at) + '</td>' +
      '<td class="mono" style="font-weight:600">' + t.symbol + '</td>' +
      '<td style="color:' + sideColor + ';font-weight:600">' + t.side + '</td>' +
      '<td class="mono">' + t.qty + '</td>' +
      '<td class="mono">' + fmtUsd(t.entry_price) + '</td>' +
      '<td class="mono">' + (t.stop_loss ? fmtUsd(t.stop_loss) : '—') + '</td>' +
      '<td class="mono" style="font-size:10px">' + tp + '</td>' +
      '<td class="mono">' + exitOrCurrent + '</td>' +
      '<td class="mono" style="color:' + pnlColor + '">' + (pnl != null && t.status === 'CLOSED' ? fmtUsd(pnl) : '—') + '</td>' +
      '<td><span class="wl-outcome ' + statusClass + '">' + t.status + '</span></td>' +
      '<td>' + closeBtn + '</td>' +
    '</tr>';
  }).join('');
}
`;
