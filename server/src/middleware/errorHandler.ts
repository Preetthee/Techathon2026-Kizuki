import { Request, Response, NextFunction } from 'express';
import config from '../config';

interface AppError extends Error {
  statusCode?: number;
  status?: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: AppError, req: Request, res: Response, next: NextFunction): void {
  const status = err.statusCode ?? err.status ?? 500;
  console.error(`[error] ${req.method} ${req.url} — ${err.message}`);
  if (config.isDev) console.error(err.stack);

  res.status(status).json({
    error: {
      message: err.message || 'Internal Server Error',
      status,
      ...(config.isDev && { stack: err.stack }),
    },
  });
}
