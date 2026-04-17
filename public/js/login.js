const username = document.getElementById('username');
const pwd = document.getElementById('pwd');
const btn = document.getElementById('login');
const err = document.getElementById('err');

let isSubmitting = false;

// ensureToastContainer 函数已由 toast-utils.js 统一提供

// showToast 函数已由 toast-utils.js 统一提供

// 显示来自其他页面的提示消息
(function showLoginMessage() {
  const msg = sessionStorage.getItem('mf:login-message');
  if (msg) {
    sessionStorage.removeItem('mf:login-message');
    // 延迟显示，确保 toast 容器已加载
    setTimeout(() => {
      if (typeof showToast === 'function') {
        showToast(msg, 'info');
      } else if (err) {
        err.textContent = msg;
        err.style.color = '#6366f1';
      }
    }, 300);
  }
})();

async function doLogin(){
  if (isSubmitting) return;
  const user = (username.value || '').trim();
  const password = (pwd.value || '').trim();
  if (!user){ err.textContent = '用户名不能为空'; await showToast('用户名不能为空','warn'); return; }
  if (!password){ err.textContent = '密码不能为空'; await showToast('密码不能为空','warn'); return; }
  err.textContent = '';
  isSubmitting = true;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '正在登录…';

  try{
    // 目标页：优先使用登录页上的 redirect 参数
    const target = (function(){
      try{ const u=new URL(location.href); const t=(u.searchParams.get('redirect')||'').trim(); return t || '/'; }catch(_){ return '/'; }
    })();
    
    // 等待登录请求完成，提高成功率
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username: user, password })
    });
    
    if (response.ok) {
      const result = await response.json();
      if (result.success) {
        let finalTarget = target;
        if (result.role === 'mailbox') {
          finalTarget = '/html/mailbox.html';
        } else if (target === '/' && (result.role === 'admin' || result.role === 'guest')) {
          finalTarget = '/';
        }

        let sessionReady = null;
        try {
          if (window.AuthSession && typeof window.AuthSession.waitForSessionReady === 'function') {
            sessionReady = await window.AuthSession.waitForSessionReady({ timeoutMs: 4000, intervalMs: 150 });
          } else {
            const sessionResponse = await fetch('/api/session', {
              method: 'GET',
              headers: { 'Cache-Control': 'no-cache' },
              credentials: 'include'
            });
            sessionReady = sessionResponse.ok ? await sessionResponse.json() : null;
          }
        } catch (_) {
          sessionReady = null;
        }

        if (!sessionReady) {
          await showToast('登录成功，但会话尚未建立，正在重试…', 'info');
          if (window.AuthGuard && window.AuthGuard.goLoading){
            window.AuthGuard.goLoading(finalTarget, '正在建立登录会话…', { force: true });
          }else{
            location.replace('/templates/loading.html?redirect=' + encodeURIComponent(finalTarget) + '&status=' + encodeURIComponent('正在建立登录会话…') + '&force=1');
          }
          return;
        }

        try {
          sessionStorage.setItem('auth_checked', 'true');
          sessionStorage.setItem('auth_checked_ts', String(Date.now()));
        } catch (_) {}

        await showToast('登录成功，正在跳转...', 'success');
        setTimeout(() => {
          location.replace(finalTarget);
        }, 200);
        return;
      }
    } else {
      // 登录失败，显示错误信息
      const errorText = await response.text();
      err.textContent = errorText || '登录失败';
      await showToast(errorText || '登录失败', 'warn');
      // 恢复按钮状态
      isSubmitting = false;
      btn.disabled = false;
      btn.textContent = original;
      return;
    }
    
    // 兜底：进入 loading 页面轮询
    if (window.AuthGuard && window.AuthGuard.goLoading){
      window.AuthGuard.goLoading(target, '正在登录…', { force: true });
    }else{
      location.replace('/templates/loading.html?redirect=' + encodeURIComponent(target) + '&status=' + encodeURIComponent('正在登录…') + '&force=1');
    }
    return;
  }catch(e){
    // 网络错误或其他异常，显示错误并进入 loading
    err.textContent = '网络错误，请重试';
    await showToast('网络连接失败，请检查网络后重试', 'warn');
    // 恢复按钮状态
    isSubmitting = false;
    btn.disabled = false;
    btn.textContent = original;
    // 仍然进入 loading 作为兜底
    location.replace('/templates/loading.html?status=' + encodeURIComponent('正在登录…') + '&force=1');
    return;
  }finally{
    // 确保按钮状态恢复（防止某些异常情况）
    if (isSubmitting) {
      isSubmitting = false;
      btn.disabled = false;
      btn.textContent = original;
    }
  }
}

btn.addEventListener('click', doLogin);
pwd.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
username.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

