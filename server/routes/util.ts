import type { NextFunction, Request, RequestHandler, Response } from 'express';

export function wrap(fn: (req: Request, res: Response) => unknown | Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export function fail(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

export function asString(v: unknown, max = 20000): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

export function asStringArray(v: unknown, max = 60): string[] {
  if (Array.isArray(v)) {
    return v
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, max);
  }
  if (typeof v === 'string') {
    return v
      .split(/[,\n]/)
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, max);
  }
  return [];
}

export function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function asBool(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1 || v === '1') return true;
  if (v === 'false' || v === 0 || v === '0') return false;
  return fallback;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const message = err instanceof Error ? err.message : String(err);
  const status = /not found/i.test(message) ? 404 : 400;
  if (!res.headersSent) res.status(status).json({ error: message });
}
