// ─── Dashboard Login Page — Google Sign-In ───

export function renderLoginPage(baseUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>YMSA — Sign In</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📊</text></svg>">
<link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<script src="https://accounts.google.com/gsi/client" async defer><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Google Sans',sans-serif;background:#0D1117;color:#E6EDF3;min-height:100vh;display:flex;align-items:center;justify-content:center}
.login-box{background:#161B22;border:1px solid #30363D;border-radius:16px;padding:48px;max-width:420px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.5)}
.login-box h1{font-size:28px;font-weight:700;color:#80CBC4;margin-bottom:8px}
.login-box p{color:#8B949E;font-size:14px;margin-bottom:32px;line-height:1.5}
.login-box .logo{font-size:64px;margin-bottom:16px}
#error-msg{color:#EF5350;font-size:13px;margin-top:16px;display:none}
#loading-msg{color:#80CBC4;font-size:13px;margin-top:16px;display:none}
.g-signin{display:flex;justify-content:center;margin-top:8px}
</style>
</head>
<body>
<div class="login-box">
  <div class="logo">📊</div>
  <h1>YMSA Trading System</h1>
  <p>6-Engine Trading Intelligence<br>Sign in with your authorized Google account</p>
  <div class="g-signin">
    <div id="g_id_onload"
      data-client_id="121161777538-sm5bar8ufps6jtvll243rk29c9ppvrc0.apps.googleusercontent.com"
      data-callback="handleCredentialResponse"
      data-auto_prompt="false">
    </div>
    <div class="g_id_signin"
      data-type="standard"
      data-shape="pill"
      data-theme="filled_black"
      data-text="signin_with"
      data-size="large"
      data-logo_alignment="left">
    </div>
  </div>
  <div id="error-msg"></div>
  <div id="loading-msg">Verifying...</div>
</div>
<script>
const BASE = '${baseUrl}';
async function handleCredentialResponse(response) {
  document.getElementById('loading-msg').style.display = 'block';
  document.getElementById('error-msg').style.display = 'none';
  try {
    const res = await fetch(BASE + '/auth/google', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ idToken: response.credential }),
      credentials: 'include',
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      window.location.reload();
    } else {
      document.getElementById('loading-msg').style.display = 'none';
      const e = document.getElementById('error-msg');
      e.textContent = data.error || 'Access denied';
      e.style.display = 'block';
    }
  } catch (err) {
    document.getElementById('loading-msg').style.display = 'none';
    const e = document.getElementById('error-msg');
    e.textContent = 'Network error — try again';
    e.style.display = 'block';
  }
}
fetch(BASE + '/health').then(r=>r.json()).then(d=>{}).catch(()=>{});
</script>
</body>
</html>`;
}
