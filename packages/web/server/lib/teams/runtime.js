export const createTeamsRuntime = ({
  service,
  globalEventHub = null,
  pollMs = 5_000,
} = {}) => {
  let timer = null;
  let unsubscribe = null;
  let ticking = false;

  const safeTick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await service.tickScheduler();
    } catch {
      // ignore background tick errors
    } finally {
      ticking = false;
    }
  };

  const start = () => {
    if (!timer) {
      timer = setInterval(() => void safeTick(), pollMs);
      timer.unref?.();
    }
    if (globalEventHub && !unsubscribe) {
      unsubscribe = globalEventHub.subscribeEvent((event) => {
        const type = event?.payload?.type ?? event?.type;
        if (type === 'session.idle' || type === 'session.execution.succeeded' || type === 'session.execution.failed') {
          void safeTick();
        }
      });
    }
  };

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
    if (unsubscribe) {
      try { unsubscribe(); } catch { /* ignore */ }
      unsubscribe = null;
    }
  };

  return {
    ...service,
    start,
    stop,
    tick: safeTick,
  };
};
