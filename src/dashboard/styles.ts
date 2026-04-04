// ─── Dashboard CSS — Material Design 3 dark theme ───

export const DASHBOARD_CSS = `
:root {
  --c-primary: #80CBC4;
  --c-on-primary: #003731;
  --c-primary-ctr: #00504A;
  --c-secondary: #B0BEC5;
  --c-tertiary: #FFB74D;
  --c-error: #EF5350;
  --c-success: #66BB6A;
  --c-warning: #FFA726;
  --c-surface: #0D1117;
  --c-surface-1: #161B22;
  --c-surface-2: #21262D;
  --c-surface-3: #30363D;
  --c-on-surface: #E6EDF3;
  --c-on-surface-2: #8B949E;
  --c-outline: #30363D;
  --c-buy: #3FB950;
  --c-sell: #F85149;
  --radius-l: 16px;
  --radius-m: 12px;
  --radius-s: 8px;
  --shadow-1: 0 1px 3px rgba(0,0,0,.4);
  --shadow-2: 0 4px 12px rgba(0,0,0,.4);
}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Google Sans',sans-serif;background:var(--c-surface);color:var(--c-on-surface);min-height:100vh;-webkit-text-size-adjust:100%;overflow-x:hidden}

/* ═══ TOP BAR — mobile-first ═══ */
.top-bar{background:var(--c-surface-1);border-bottom:1px solid var(--c-outline);padding:10px 12px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;backdrop-filter:blur(12px);gap:8px;flex-wrap:wrap}
.top-bar h1{font-size:15px;font-weight:500;color:var(--c-primary);display:flex;align-items:center;gap:6px;white-space:nowrap}
.top-bar .meta{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--c-on-surface-2);flex-wrap:wrap}
.live-dot{width:8px;height:8px;background:var(--c-success);border-radius:50%;animation:pulse 2s infinite;flex-shrink:0}
.mode-badge{padding:3px 10px;border-radius:12px;font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.5px}
.mode-badge.paper{background:rgba(255,183,77,.15);color:var(--c-tertiary);border:1px solid var(--c-tertiary)}
.mode-badge.live{background:rgba(248,81,73,.15);color:var(--c-error);border:1px solid var(--c-error)}
.mode-badge.signals{background:rgba(128,203,196,.15);color:var(--c-primary);border:1px solid var(--c-primary)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

/* ═══ CONTAINER — mobile-first ═══ */
.container{max-width:1440px;margin:0 auto;padding:12px;display:flex;flex-direction:column;gap:12px}

/* ═══ CARDS — mobile-first ═══ */
.card{background:var(--c-surface-1);border-radius:var(--radius-l);padding:14px;box-shadow:var(--shadow-1);border:1px solid var(--c-outline);transition:border-color .2s}
.card:hover{border-color:var(--c-primary)}
.card-title{font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:1px;color:var(--c-on-surface-2);margin-bottom:6px}
.card-value{font-family:'Roboto Mono',monospace;font-size:22px;font-weight:700;color:var(--c-primary);word-break:break-word}
.card-value.up{color:var(--c-buy)}
.card-value.down{color:var(--c-sell)}
.card-sub{font-size:11px;color:var(--c-on-surface-2);margin-top:2px}

/* ═══ GRID LAYOUTS — mobile-first (1-col base, scale up) ═══ */
.hero-grid{display:grid;grid-template-columns:1fr;gap:10px}
.two-col{display:grid;grid-template-columns:1fr;gap:12px}
.three-col{display:grid;grid-template-columns:1fr;gap:10px}

/* ═══ RESPONSIVE BREAKPOINTS — mobile-first (min-width) ═══ */
@media(min-width:480px){
  .hero-grid{grid-template-columns:repeat(2,1fr)}
}
@media(min-width:768px){
  .top-bar{padding:12px 20px}
  .top-bar h1{font-size:18px}
  .container{padding:16px;gap:14px}
  .card{padding:16px}
  .card-value{font-size:24px}
  .hero-grid{grid-template-columns:repeat(3,1fr)}
  .two-col{grid-template-columns:1fr 1fr;gap:16px}
  .three-col{grid-template-columns:1fr 1fr 1fr;gap:12px}
}
@media(min-width:1100px){
  .top-bar{padding:14px 24px}
  .top-bar h1{font-size:20px}
  .top-bar .meta{gap:14px;font-size:12px}
  .container{padding:20px;gap:16px}
  .card{padding:20px}
  .card-value{font-size:28px}
  .hero-grid{grid-template-columns:repeat(6,1fr);gap:12px}
}

/* Section */
.section{display:flex;flex-direction:column;gap:10px}
.section-hdr{font-size:13px;font-weight:500;color:var(--c-secondary);display:flex;align-items:center;gap:6px;padding-bottom:4px;border-bottom:1px solid var(--c-outline);flex-wrap:wrap}

/* ═══ TABLES — mobile-first with horizontal scroll ═══ */
.tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -2px;padding:0 2px}
.tbl{width:100%;border-collapse:collapse;font-size:11px;min-width:480px}
.tbl th{text-align:left;padding:6px 8px;font-weight:500;color:var(--c-on-surface-2);border-bottom:1px solid var(--c-outline);font-size:10px;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap}
.tbl td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.04);white-space:nowrap}
.tbl tr:hover td{background:rgba(128,203,196,.04)}
.mono{font-family:'Roboto Mono',monospace;font-size:11px}
@media(min-width:768px){
  .section-hdr{font-size:14px;gap:8px}
  .tbl{font-size:12px}
  .tbl th{padding:8px 10px}
  .tbl td{padding:8px 10px}
}

/* Regime badge */
.regime-badge{display:inline-flex;align-items:center;gap:6px;padding:6px 16px;border-radius:20px;font-size:14px;font-weight:500}
.regime-badge.up{background:rgba(63,185,80,.15);color:var(--c-buy);border:1px solid var(--c-buy)}
.regime-badge.down{background:rgba(248,81,73,.15);color:var(--c-sell);border:1px solid var(--c-sell)}
.regime-badge.range{background:rgba(128,203,196,.15);color:var(--c-primary);border:1px solid var(--c-primary)}
.regime-badge.volatile{background:rgba(255,167,38,.15);color:var(--c-warning);border:1px solid var(--c-warning)}

/* Engine cards — mobile-first */
.engine-grid{display:grid;grid-template-columns:1fr;gap:10px}
@media(min-width:480px){.engine-grid{grid-template-columns:1fr 1fr}}
@media(min-width:768px){.engine-grid{grid-template-columns:repeat(3,1fr)}}
.engine-card{background:var(--c-surface-2);border-radius:var(--radius-m);padding:14px;border-left:3px solid var(--c-primary)}
.engine-card .name{font-size:13px;font-weight:500;margin-bottom:2px}
.engine-card .eid{font-family:'Roboto Mono',monospace;font-size:10px;color:var(--c-on-surface-2)}
.engine-card .stats{display:flex;gap:8px;margin-top:8px;font-size:10px;color:var(--c-on-surface-2);flex-wrap:wrap}
.engine-card .stats span{display:flex;flex-direction:column;gap:1px;min-width:40px}
.engine-card .stats .val{font-family:'Roboto Mono',monospace;font-weight:500;color:var(--c-on-surface);font-size:12px}
.weight-bar{height:4px;background:var(--c-surface);border-radius:2px;margin-top:8px;overflow:hidden}
.weight-bar-fill{height:100%;background:var(--c-primary);border-radius:2px;transition:width .6s}

/* Signal chip */
.signal-chip{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--c-surface-2);border-radius:var(--radius-s);font-size:12px}
.signal-chip .dir{font-family:'Roboto Mono',monospace;font-weight:700;font-size:11px;padding:2px 8px;border-radius:4px}
.signal-chip .dir.BUY{background:rgba(63,185,80,.2);color:var(--c-buy)}
.signal-chip .dir.SELL{background:rgba(248,81,73,.2);color:var(--c-sell)}
.signal-chip .dir.HOLD{background:rgba(128,203,196,.2);color:var(--c-primary)}

/* Risk event */
.risk-event{display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--c-surface-2);border-radius:var(--radius-s);font-size:12px;border-left:3px solid var(--c-warning)}
.risk-event.CRITICAL{border-left-color:var(--c-error)}
.risk-event.HALT{border-left-color:var(--c-sell)}

/* Chips */
.chip-grid{display:flex;flex-wrap:wrap;gap:6px}
.chip{display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:16px;font-size:11px;font-family:'Roboto Mono',monospace;border:1px solid var(--c-outline)}
.chip.set{background:rgba(102,187,106,.1);border-color:var(--c-success);color:var(--c-success)}
.chip.unset{background:rgba(239,83,80,.1);border-color:var(--c-error);color:var(--c-error)}

/* API grid — mobile-first */
.api-grid{display:grid;grid-template-columns:1fr;gap:8px}
@media(min-width:480px){.api-grid{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}}
.api-item{display:flex;align-items:center;gap:8px;padding:10px;background:var(--c-surface-2);border-radius:var(--radius-s)}
.api-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.api-dot.ok{background:var(--c-success)}.api-dot.err{background:var(--c-error)}

/* Cron table */
.cron-expr{font-family:'Roboto Mono',monospace;font-size:11px;background:var(--c-surface);padding:2px 8px;border-radius:4px;color:var(--c-tertiary)}

/* Risk limits — mobile-first */
.risk-grid{display:grid;grid-template-columns:1fr;gap:8px}
@media(min-width:480px){.risk-grid{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}}
.risk-item{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--c-surface-2);border-radius:var(--radius-s)}
.risk-label{font-size:11px;color:var(--c-on-surface-2)}
.risk-value{font-family:'Roboto Mono',monospace;font-size:13px;font-weight:500;color:var(--c-tertiary)}

/* Endpoints — mobile-first */
.endpoint-list{display:grid;grid-template-columns:1fr;gap:4px}
@media(min-width:480px){.endpoint-list{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}}
.endpoint{font-family:'Roboto Mono',monospace;font-size:11px;padding:6px 10px;background:var(--c-surface-2);border-radius:4px;color:var(--c-on-surface-2);cursor:pointer;transition:background .15s}
.endpoint:hover{background:var(--c-surface-3);color:var(--c-primary)}
.endpoint .method{color:var(--c-success);font-weight:500}

/* Test panel — mobile-first */
.test-grid{display:grid;grid-template-columns:1fr;gap:10px}
@media(min-width:480px){.test-grid{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}}
.test-panel{background:var(--c-surface-1);border-radius:var(--radius-m);padding:14px;border:1px solid var(--c-outline)}
.test-btn{padding:8px 16px;font-size:12px;font-weight:500;border:none;border-radius:16px;cursor:pointer;background:var(--c-primary-ctr);color:var(--c-primary);transition:filter .15s;min-height:44px;touch-action:manipulation}
.test-btn:hover{filter:brightness(1.2)}
.test-result{margin-top:8px;font-family:'Roboto Mono',monospace;font-size:11px;background:var(--c-surface);border-radius:6px;padding:10px;max-height:180px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;display:none}

/* Sparkline */
.sparkline{display:flex;align-items:flex-end;gap:2px;height:40px}
.spark-bar{min-width:4px;flex:1;border-radius:2px 2px 0 0;transition:height .3s}

/* Scrollable panel */
.scroll-panel{max-height:320px;overflow-y:auto}

/* Refresh bar */
.refresh-bar{height:2px;background:var(--c-surface-1);position:fixed;bottom:0;left:0;right:0;z-index:999}
.refresh-bar-fill{height:100%;background:var(--c-primary);width:100%;transition:width 1s linear}

/* Scrollbar */
::-webkit-scrollbar{width:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--c-outline);border-radius:3px}

/* Loading */
.loading{color:var(--c-on-surface-2);font-size:12px;padding:12px;text-align:center}
.empty{color:var(--c-on-surface-2);font-size:12px;padding:16px;text-align:center;font-style:italic}

/* ═══ WIN/LOSS TABLE ═══ */
.wl-filters{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;align-items:center}
.wl-filter-btn{padding:8px 14px;border-radius:16px;font-size:11px;font-weight:500;border:1px solid var(--c-outline);background:transparent;color:var(--c-on-surface-2);cursor:pointer;transition:all .2s;min-height:44px;touch-action:manipulation}
.wl-filter-btn.active{background:var(--c-primary-ctr);color:var(--c-primary);border-color:var(--c-primary)}
.wl-filter-btn:hover{border-color:var(--c-primary);color:var(--c-primary)}
.wl-search{padding:8px 12px;border-radius:16px;font-size:11px;border:1px solid var(--c-outline);background:var(--c-surface-2);color:var(--c-on-surface);outline:none;width:100%;min-height:44px;transition:border-color .2s;touch-action:manipulation}
.wl-search:focus{border-color:var(--c-primary)}
@media(min-width:480px){.wl-search{margin-left:auto;width:140px}.wl-search:focus{width:180px}}
.wl-row{cursor:pointer;transition:background .15s}
.wl-row:hover td{background:rgba(128,203,196,.08)!important}
.wl-outcome{padding:2px 10px;border-radius:12px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.wl-outcome.WIN{background:rgba(63,185,80,.15);color:var(--c-buy)}
.wl-outcome.LOSS{background:rgba(248,81,73,.15);color:var(--c-sell)}
.wl-outcome.PENDING{background:rgba(128,203,196,.15);color:var(--c-primary)}
.wl-outcome.BREAKEVEN{background:rgba(176,190,197,.15);color:var(--c-secondary)}
.wl-outcome.EXPIRED{background:rgba(176,190,197,.1);color:var(--c-on-surface-2)}
.wl-stats-row{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:12px}
@media(min-width:480px){.wl-stats-row{grid-template-columns:repeat(3,1fr)}}
@media(min-width:768px){.wl-stats-row{grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px;margin-bottom:16px}}
.wl-stat{background:var(--c-surface-2);border-radius:var(--radius-s);padding:10px;text-align:center}
.wl-stat .label{font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:var(--c-on-surface-2);margin-bottom:4px}
.wl-stat .val{font-family:'Roboto Mono',monospace;font-size:16px;font-weight:700}
@media(min-width:768px){.wl-stat{padding:12px}.wl-stat .val{font-size:18px}}
.wl-action-btns{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.wl-action-btn{padding:4px 12px;border-radius:12px;font-size:10px;font-weight:500;border:none;cursor:pointer;transition:filter .15s}
.wl-action-btn:hover{filter:brightness(1.2)}
.wl-action-btn.win{background:rgba(63,185,80,.2);color:var(--c-buy)}
.wl-action-btn.loss{background:rgba(248,81,73,.2);color:var(--c-sell)}
.wl-action-btn.be{background:rgba(176,190,197,.2);color:var(--c-secondary)}
.wl-action-btn.exp{background:rgba(176,190,197,.15);color:var(--c-on-surface-2)}
/* Sort */
.tbl th.sortable{cursor:pointer;user-select:none;position:relative;padding-right:14px}
.tbl th.sortable:hover{color:var(--c-primary)}
.tbl th.sortable::after{content:'⇅';position:absolute;right:2px;top:50%;transform:translateY(-50%);font-size:9px;opacity:.4}
.tbl th.sortable.asc::after{content:'↑';opacity:1;color:var(--c-primary)}
.tbl th.sortable.desc::after{content:'↓';opacity:1;color:var(--c-primary)}
/* Confidence bar */
.conf-bar{display:inline-flex;align-items:center;gap:4px}
.conf-fill{height:6px;border-radius:3px;min-width:4px}
/* R:R pill */
.rr-pill{padding:1px 6px;border-radius:8px;font-size:9px;font-weight:600;letter-spacing:.3px}
.rr-good{background:rgba(63,185,80,.12);color:var(--c-buy)}
.rr-ok{background:rgba(128,203,196,.12);color:var(--c-primary)}
.rr-bad{background:rgba(248,81,73,.12);color:var(--c-sell)}
/* Engine accuracy cards — mobile-first */
.engine-acc-row{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 16px}
.engine-acc-card{flex:1 1 100%;min-width:0;background:var(--c-surface-2);border-radius:var(--radius-s);padding:10px 12px;position:relative;overflow:hidden}
@media(min-width:480px){.engine-acc-card{flex:1 1 calc(50% - 4px);min-width:120px}}
@media(min-width:768px){.engine-acc-card{flex:1 1 0;min-width:130px}}
.engine-acc-card .eng-name{font-size:11px;font-weight:700;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px}
.engine-acc-card .eng-stats{display:flex;gap:12px;font-size:10px;color:var(--c-on-surface-2)}
.engine-acc-card .eng-stats span{font-family:'Roboto Mono',monospace}
.engine-acc-bar{height:3px;border-radius:2px;background:var(--c-outline);margin-top:6px}
.engine-acc-fill{height:100%;border-radius:2px;transition:width .4s ease}
/* Age badge */
.age-badge{padding:1px 6px;border-radius:8px;font-size:9px;font-weight:500;background:var(--c-surface-2);color:var(--c-on-surface-2)}
.age-badge.fresh{background:rgba(128,203,196,.12);color:var(--c-primary)}
.age-badge.aging{background:rgba(255,193,7,.12);color:#ffc107}
.age-badge.old{background:rgba(248,81,73,.12);color:var(--c-sell)}

/* ═══ MODAL — mobile-first ═══ */
.modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);backdrop-filter:blur(6px);z-index:1000;display:none;align-items:flex-end;justify-content:center;padding:0}
.modal-overlay.active{display:flex}
.modal{background:var(--c-surface-1);border:1px solid var(--c-outline);border-radius:var(--radius-l) var(--radius-l) 0 0;max-width:680px;width:100%;max-height:92vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.6);animation:modalIn .2s ease-out}
@keyframes modalIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
.modal-header{display:flex;align-items:center;justify-content:space-between;padding:16px;border-bottom:1px solid var(--c-outline);position:sticky;top:0;background:var(--c-surface-1);z-index:1;gap:8px}
.modal-header h2{font-size:14px;font-weight:600;color:var(--c-on-surface);display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}
.modal-close{width:44px;height:44px;border-radius:50%;border:none;background:var(--c-surface-2);color:var(--c-on-surface-2);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0;touch-action:manipulation}
.modal-close:hover{background:var(--c-surface-3);color:var(--c-on-surface)}
.modal-body{padding:16px}
@media(min-width:768px){
  .modal-overlay{align-items:center;padding:20px}
  .modal{border-radius:var(--radius-l)}
  .modal-header{padding:20px 24px}
  .modal-header h2{font-size:16px;gap:8px}
  .modal-close{width:32px;height:32px}
  .modal-body{padding:20px 24px}
}
.modal-section{margin-bottom:16px}
.modal-section-title{font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:1px;color:var(--c-on-surface-2);margin-bottom:8px;display:flex;align-items:center;gap:6px}
.modal-kv{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:11px}
.modal-kv .k{color:var(--c-on-surface-2)}.modal-kv .v{font-family:'Roboto Mono',monospace;font-weight:500;text-align:right;word-break:break-word}
@media(min-width:768px){.modal-section{margin-bottom:20px}.modal-kv{gap:6px 16px;font-size:12px}}
.modal-alert-text{font-family:'Roboto Mono',monospace;font-size:11px;background:var(--c-surface);border-radius:var(--radius-s);padding:14px;white-space:pre-wrap;word-break:break-word;color:var(--c-on-surface-2);max-height:240px;overflow-y:auto;border:1px solid var(--c-outline)}
.modal-outcome-form{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.modal-outcome-form select,.modal-outcome-form input{padding:8px 12px;border-radius:8px;border:1px solid var(--c-outline);background:var(--c-surface-2);color:var(--c-on-surface);font-size:12px;font-family:'Roboto Mono',monospace;min-height:44px;touch-action:manipulation}
.modal-outcome-form button{padding:8px 16px;border-radius:8px;border:none;background:var(--c-primary-ctr);color:var(--c-primary);font-size:12px;font-weight:500;cursor:pointer;transition:filter .15s;min-height:44px;touch-action:manipulation}
.modal-outcome-form button:hover{filter:brightness(1.2)}

/* ═══ P&L DASHBOARD — mobile-first ═══ */
.pnl-hero{display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:12px}
@media(min-width:480px){.pnl-hero{grid-template-columns:repeat(2,1fr)}}
@media(min-width:768px){.pnl-hero{grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}}
@media(min-width:1100px){.pnl-hero{grid-template-columns:repeat(4,1fr)}}
.pnl-chart-container{position:relative;height:200px;background:var(--c-surface);border-radius:var(--radius-s);padding:12px;overflow:hidden}
.pnl-chart-container canvas{width:100%!important;height:100%!important}
.pnl-monthly-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:6px}
@media(min-width:480px){.pnl-monthly-grid{grid-template-columns:repeat(auto-fill,minmax(100px,1fr))}}
.pnl-month-cell{padding:10px 8px;border-radius:var(--radius-s);text-align:center;font-family:'Roboto Mono',monospace;font-size:11px;font-weight:600;transition:transform .15s}
.pnl-month-cell:hover{transform:scale(1.05)}
.pnl-month-cell .month-label{font-size:9px;font-weight:400;color:var(--c-on-surface-2);margin-bottom:2px;display:block}
.pnl-bar-chart{display:flex;align-items:flex-end;gap:3px;height:120px;padding:8px 0}
.pnl-bar{flex:1;min-width:0;border-radius:2px 2px 0 0;position:relative;transition:height .3s}
.pnl-bar:hover{opacity:.8}
.pnl-bar .bar-tip{position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:8px;white-space:nowrap;color:var(--c-on-surface-2);display:none}
.pnl-bar:hover .bar-tip{display:block}
.pnl-breakdown-grid{display:grid;grid-template-columns:1fr;gap:12px}
@media(min-width:768px){.pnl-breakdown-grid{grid-template-columns:1fr 1fr}}
.pnl-streak-badge{display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:12px;font-size:11px;font-weight:500}
.pnl-streak-badge.win{background:rgba(63,185,80,.15);color:var(--c-buy)}
.pnl-streak-badge.loss{background:rgba(248,81,73,.15);color:var(--c-sell)}
.tab-bar{display:flex;gap:2px;background:var(--c-surface-2);border-radius:var(--radius-s);padding:2px;margin-bottom:12px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.tab-bar::-webkit-scrollbar{display:none}
.tab-btn{flex:0 0 auto;padding:10px 12px;border:none;border-radius:6px;font-size:11px;font-weight:500;background:transparent;color:var(--c-on-surface-2);cursor:pointer;transition:all .2s;white-space:nowrap;min-height:44px;touch-action:manipulation}
.tab-btn.active{background:var(--c-primary-ctr);color:var(--c-primary)}
.tab-btn:hover:not(.active){color:var(--c-on-surface)}
@media(min-width:768px){.tab-btn{flex:1;padding:8px 16px;min-height:auto}}
.tab-content{display:none}.tab-content.active{display:block}

/* ═══ UTILITY CLASSES — replacing inline styles for responsive ═══ */
.card-value-sm{font-family:'Roboto Mono',monospace;font-size:18px;font-weight:700;color:var(--c-primary);word-break:break-word}
@media(min-width:768px){.card-value-sm{font-size:20px}}
.regime-row{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
.regime-details{font-size:11px;color:var(--c-on-surface-2)}
@media(min-width:768px){.regime-details{font-size:12px}}
.test-panel-row{display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap}
.test-panel-name{font-size:12px;font-weight:600}
@media(min-width:768px){.test-panel-name{font-size:13px}}
.sim-trades-header{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.06);flex-wrap:wrap;gap:8px}
@media(min-width:768px){.sim-trades-header{padding:12px 16px}}
.sim-trades-desc{font-size:9px;color:var(--c-on-surface-2);margin-left:4px}
`;
