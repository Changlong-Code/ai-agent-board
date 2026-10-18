import type { RequestHandler } from 'express';

/** Local Windows profile rejects foreign browser origins and DNS-rebinding hosts. */
export function createWindowsLocalGuard(options: {
  enabled: boolean;
  apiPort: number;
  uiPort: number;
}): RequestHandler {
  if (!options.enabled) return (_req, _res, next) => next();
  for (const port of [options.apiPort, options.uiPort]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Windows local mode requires valid API and UI ports');
    }
  }
  const hosts = new Set<string>();
  const origins = new Set<string>();
  for (const port of [options.apiPort, options.uiPort]) {
    for (const host of ['127.0.0.1', 'localhost']) {
      hosts.add(`${host}:${port}`);
      origins.add(`http://${host}:${port}`);
    }
  }
  return (req, res, next) => {
    if (!hosts.has(req.headers.host || '')) {
      res.status(403).json({ error: 'Local Windows mode rejected the Host header' });
      return;
    }
    if (req.headers.origin && !origins.has(req.headers.origin)) {
      res.status(403).json({ error: 'Local Windows mode rejected a foreign Origin' });
      return;
    }
    next();
  };
}
