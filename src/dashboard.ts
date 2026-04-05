// ─── SRE Dashboard v3.0 — Barrel ─────────────────────────────
// Re-exports from modular sub-modules under ./dashboard/

export { getSystemStatus, type SystemStatus } from './dashboard/system-status';
import { renderLoginPage } from './dashboard/login-page';
import { DASHBOARD_CSS } from './dashboard/styles';
import { DASHBOARD_BODY } from './dashboard/body-html';
import { CLIENT_CORE_JS } from './dashboard/client-core';
import { CLIENT_WINLOSS_JS } from './dashboard/client-winloss';
import { CLIENT_PNL_JS } from './dashboard/client-pnl';

export { renderLoginPage };

export function renderDashboard(baseUrl: string, isAuthed: boolean = false): string {
  if (!isAuthed) {
    return renderLoginPage(baseUrl);
  }
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>YMSA v3.6 — Trading Dashboard</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📊</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
${DASHBOARD_CSS}
</style>
</head>
<body>
${DASHBOARD_BODY}
<script>
const BASE = '${baseUrl}';
const REFRESH = 60;
let countdown = REFRESH;
${CLIENT_CORE_JS}
${CLIENT_WINLOSS_JS}
${CLIENT_PNL_JS}
</script>
</body>
</html>`;
}
