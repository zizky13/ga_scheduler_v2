import express, { type Application } from 'express';
import pinoHttp from 'pino-http';
import { getRootLogger } from './logger';
import { requestId } from './middleware/requestId';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { createV1Router } from './router';

export interface CreateServerOptions {
  /**
   * Optional hook invoked after the v1 router is mounted but before the 404 +
   * error middleware. Tests use this to attach throw-only fixture routes.
   * Production callers should leave it unset.
   */
  beforeErrorHandler?: (app: Application) => void;
}

export function createServer(options: CreateServerOptions = {}): Application {
  const app = express();

  app.disable('x-powered-by');

  app.use(requestId());

  app.use(
    pinoHttp({
      logger: getRootLogger(),
      // pino-http calls genReqId before our middleware would set req.id, so we
      // re-read the header here applying the same validation. requestId()
      // upstream still owns res header propagation.
      genReqId: (req, res) => {
        const fromReq = (req as unknown as { id?: unknown }).id;
        if (typeof fromReq === 'string' && fromReq.length > 0) {
          return fromReq;
        }
        const fromRes = res.getHeader('X-Request-Id');
        return typeof fromRes === 'string' ? fromRes : '';
      },
    }),
  );

  app.use(express.json({ limit: '1mb' }));

  app.use('/api/v1', createV1Router());

  options.beforeErrorHandler?.(app);

  app.use(notFoundHandler());
  app.use(errorHandler());

  return app;
}

export function start(): void {
  const port = Number(process.env.PORT ?? 3000);
  const app = createServer();
  app.listen(port, () => {
    getRootLogger().info({ port }, 'API server listening');
  });
}

if (require.main === module) {
  start();
}
