(function(global) {
  function getFetchImpl(options) {
    if (typeof options.fetchImpl === 'function') return options.fetchImpl;
    if (typeof global.fetch === 'function') return global.fetch.bind(global);
    return null;
  }

  function createAbortController(options) {
    if (typeof options.createAbortController === 'function') {
      return options.createAbortController();
    }
    if (typeof global.AbortController === 'function') {
      return new global.AbortController();
    }
    return null;
  }

  function sleep(ms, sleepImpl) {
    if (typeof sleepImpl === 'function') {
      return sleepImpl(ms);
    }
    return new Promise((resolve) => {
      global.setTimeout(resolve, Math.max(0, ms));
    });
  }

  async function fetchSession(options) {
    const opts = options || {};
    const fetchImpl = getFetchImpl(opts);
    if (!fetchImpl) return null;

    const requestOptions = {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Cache-Control': 'no-cache',
        ...(opts.headers || {})
      }
    };

    const timeoutMs = Number.isFinite(Number(opts.timeoutMs)) ? Math.max(0, Number(opts.timeoutMs)) : 2500;
    const controller = createAbortController(opts);
    let timeoutId = null;

    try {
      if (controller && timeoutMs > 0) {
        requestOptions.signal = controller.signal;
        timeoutId = global.setTimeout(() => {
          try { controller.abort(); } catch (_) {}
        }, timeoutMs);
      }

      const response = await fetchImpl('/api/session', requestOptions);
      if (!response || !response.ok) return null;
      return await response.json();
    } catch (_) {
      return null;
    } finally {
      if (timeoutId !== null) {
        global.clearTimeout(timeoutId);
      }
    }
  }

  async function waitForSessionReady(options) {
    const opts = options || {};
    const nowImpl = typeof opts.nowImpl === 'function' ? opts.nowImpl : () => Date.now();
    const timeoutMs = Number.isFinite(Number(opts.timeoutMs)) ? Math.max(0, Number(opts.timeoutMs)) : 5000;
    const intervalMs = Number.isFinite(Number(opts.intervalMs)) ? Math.max(0, Number(opts.intervalMs)) : 150;
    const startedAt = nowImpl();

    while (true) {
      const session = await fetchSession(opts);
      if (session) return session;
      if ((nowImpl() - startedAt) > timeoutMs) return null;
      await sleep(intervalMs, opts.sleepImpl);
    }
  }

  global.AuthSession = {
    fetchSession,
    waitForSessionReady
  };
})(typeof window !== 'undefined' ? window : globalThis);
