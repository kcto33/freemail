const statusEl = document.getElementById('status');
const codePanel = document.getElementById('code-panel');
const codeEl = document.getElementById('code');
const copyBtn = document.getElementById('copy');

function setStatus(message, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#dc2626' : '#64748b';
}

function getState() {
  try {
    const url = new URL(location.href);
    return String(url.searchParams.get('state') || '').trim();
  } catch (_) {
    return '';
  }
}

function getCurrentAuthPath() {
  const url = new URL(location.href);
  return `${url.pathname}${url.search}`;
}

function getLoginRedirectUrl() {
  return `/login.html?redirect=${encodeURIComponent(getCurrentAuthPath())}`;
}

function showCode(code) {
  if (!codeEl || !codePanel) return;
  codeEl.textContent = code;
  codePanel.style.display = 'block';
}

async function ensureSession(state) {
  const response = await fetch('/api/session', {
    method: 'GET',
    credentials: 'include',
    headers: { 'Cache-Control': 'no-cache' }
  });

  if (!response.ok) {
    const redirectUrl = getLoginRedirectUrl();
    location.replace(redirectUrl);
    return false;
  }

  return true;
}

async function issueCliCode(state) {
  const response = await fetch('/api/cli/auth/issue-code', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state })
  });

  if (!response.ok) {
    let message = '授权码生成失败，请返回终端重试';
    try {
      message = (await response.text()) || message;
    } catch (_) {}
    throw new Error(message);
  }

  const payload = await response.json();
  showCode(String(payload.code || '').trim());
  setStatus('授权码已生成。');
}

async function bootstrap() {
  const state = getState();
  if (!state) {
    setStatus('缺少 CLI 授权 state 参数', true);
    return;
  }

  const ok = await ensureSession(state);
  if (!ok) return;

  setStatus('正在生成授权码…');
  await issueCliCode(state);
}

copyBtn?.addEventListener('click', async () => {
  const code = String(codeEl?.textContent || '').trim();
  if (!code) return;

  try {
    await navigator.clipboard.writeText(code);
    setStatus('授权码已复制。返回终端继续完成登录。');
  } catch (_) {
    setStatus('复制失败，请手动复制授权码。', true);
  }
});

bootstrap().catch((error) => {
  setStatus(error?.message || 'CLI 授权页加载失败，请刷新页面重试', true);
});
