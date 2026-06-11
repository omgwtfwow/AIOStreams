import { NextFunction, Request, Response, Router } from 'express';
import {
  APIError,
  constants,
  createLogger,
  decryptString,
  domainHasUserAgent,
  Env,
  appConfig,
  fromUrlSafeBase64,
  getProxyAgent,
  getTimeTakenSincePoint,
  maskSensitiveInfo,
  ProxyAliasRepository,
  shouldProxy,
  canUseProxy,
} from '@aiostreams/core';
import { z } from 'zod';
import { request, Dispatcher } from 'undici';
import { pipeline } from 'stream/promises';
import { createProxy, BuiltinProxyStats, BuiltinProxy } from '@aiostreams/core';
import { requireAdmin } from '../../middlewares/auth.js';
import { corsMiddleware } from '../../middlewares/cors.js';
import { StaticFiles } from '../../app.js';
import { Transform } from 'stream';

const logger = createLogger('server');
const router: Router = Router();

// Create a singleton instance of BuiltinProxyStats
const proxyStats = new BuiltinProxyStats();

function sanitiseHeaderValue(value: string): string {
  return value.replace(/[^\t\x20-\x7e]/g, '');
}

// A helper to iterate over the headers object
function sanitiseHeaders(
  headers: Record<string, string | string[] | number | undefined>
): Record<string, string | string[]> {
  const sanitised: Record<string, string | string[]> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      sanitised[key] = value.map((v) => sanitiseHeaderValue(v));
    } else if (typeof value === 'number') {
      sanitised[key] = String(value);
    } else {
      sanitised[key] = sanitiseHeaderValue(value);
    }
  }

  return sanitised;
}

function copyHeaders(headers: Record<string, string | string[] | undefined>) {
  const exclude = new Set([
    // Host header
    'host',
    // IP headers
    'x-client-ip',
    'x-forwarded-for',
    'cf-connecting-ip',
    'do-connecting-ip',
    'fastly-client-ip',
    'true-client-ip',
    'x-real-ip',
    'x-cluster-client-ip',
    'x-forwarded',
    'forwarded-for',
    'x-appengine-user-ip',
    'cf-pseudo-ipv4',
    'x-forwarded-proto',

    // Hop-by-hop headers
    'connection',
    'upgrade',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'proxy-connection',
  ]);
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => !exclude.has(key))
  );
}

export default router;

const ProxyAuthSchema = z.object({
  username: z.string(),
  password: z.string(),
});

const ProxyDataSchema = z.object({
  url: z.url(),
  filename: z.string().optional(),
  type: z.enum(['nzb', 'stream']).optional(),
  // These are optional, as we'll be forwarding client headers
  requestHeaders: z.record(z.string(), z.string()).optional(),
  responseHeaders: z.record(z.string(), z.string()).optional(),
});

router.use(corsMiddleware);

// GET /stats — proxy statistics for the dashboard. Admin-only via the
// dashboard session (the old `?auth=` query path is dropped). Machine-shaped:
// raw epoch ms, `users` as an array. (Breaking change is acceptable per
// 00-overview — this is an admin/self-hoster endpoint.)
router.get(
  '/stats',
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const allUserStats = await proxyStats.getAllUserStats();
      const users = Array.from(allUserStats.entries()).map(
        ([username, userStats]) => ({
          username,
          active: userStats.active,
          history: userStats.history,
        })
      );
      res.json({
        users,
        summary: {
          totalActiveConnections: users.reduce(
            (t, u) => t + u.active.length,
            0
          ),
          totalHistoryConnections: users.reduce(
            (t, u) => t + u.history.length,
            0
          ),
          usersWithActiveConnections: users.filter((u) => u.active.length > 0)
            .length,
          usersWithHistory: users.filter((u) => u.history.length > 0).length,
        },
      });
    } catch (error) {
      logger.error('Failed to get proxy stats', {
        error: error instanceof Error ? error.message : String(error),
      });
      next(error);
    }
  }
);

// POST /generate — produce a proxified URL. Admin-only (dashboard session).
// Credentials are injected server-side from AIOSTREAMS_AUTH for the session
// user — the proxy password never reaches the browser.
const GenerateSchema = ProxyDataSchema.extend({
  encrypt: z.boolean().optional().default(true),
});

router.post(
  '/generate',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = GenerateSchema.parse(req.body ?? {});
      const username = (req as { user?: { username?: string } }).user?.username;
      const password = username
        ? appConfig.bootstrap.auth?.get(username)
        : undefined;
      if (!username || !password) {
        throw new APIError(
          constants.ErrorCode.UNAUTHORIZED,
          undefined,
          'No AIOSTREAMS_AUTH credentials for the current session user'
        );
      }
      const proxy = new BuiltinProxy({
        id: constants.BUILTIN_SERVICE,
        enabled: true,
        url: appConfig.bootstrap.baseUrl,
        credentials: `${username}:${password}`,
      } as any);
      const urls = await proxy.generateUrls(
        [
          {
            url: body.url,
            filename: body.filename,
            type: body.type ?? 'stream',
            headers: {
              request: body.requestHeaders,
              response: body.responseHeaders,
            },
          },
        ],
        body.encrypt
      );
      if (!urls || 'error' in (urls as object)) {
        throw new APIError(
          constants.ErrorCode.INTERNAL_SERVER_ERROR,
          undefined,
          (urls as { error: string })?.error ?? 'Failed to generate URL'
        );
      }
      res.json({ proxified_url: (urls as string[])[0] });
    } catch (error) {
      next(error);
    }
  }
);

type ProxyAuth = z.infer<typeof ProxyAuthSchema>;
type ProxyData = z.infer<typeof ProxyDataSchema>;

interface ProxyParams {
  encryptedAuthAndData: string;
  filename?: string;
}

interface ProxyAliasParams {
  id: string;
  filename?: string;
}

const CreateAliasSchema = ProxyDataSchema.extend({
  stableKey: z.string().min(1).max(2048),
});

function sanitiseUrlForLog(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    for (const key of [
      'apikey',
      'api_key',
      'auth',
      'downloadKey',
      'key',
      'token',
    ]) {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, '[redacted]');
      }
    }
    return `${url.protocol}//${maskSensitiveInfo(url.host)}${url.pathname}${url.search}`;
  } catch {
    return '[invalid-url]';
  }
}

function buildAliasUrl(id: string, filename?: string): string {
  const suffix = filename ? `/${encodeURIComponent(filename)}` : '';
  return new URL(
    `/api/v1/proxy/s/${encodeURIComponent(id)}${suffix}`,
    appConfig.bootstrap.baseUrl
  ).toString();
}

function parseLegacyProxyPayload(encryptedAuthAndData: string): {
  auth: ProxyAuth;
  data: ProxyData;
} {
  const parts = encryptedAuthAndData.split('.');
  let encodedAuth: string | undefined;
  let encodedData: string | undefined;
  let encodeMode: 'e' | 'u' | undefined;
  if (parts.length == 2) {
    encodeMode = 'e';
    encodedAuth = parts[0];
    encodedData = parts[1];
  } else if (parts.length == 3) {
    encodeMode = parts[0] as 'e' | 'u';
    encodedAuth = parts[1];
    encodedData = parts[2];
  } else {
    throw new APIError(
      constants.ErrorCode.BAD_REQUEST,
      undefined,
      'Invalid encrypted auth and data'
    );
  }

  let rawData: string | undefined;
  let rawAuth: string | undefined;
  if (encodeMode === 'e') {
    const { data: streamData } = decryptString(encodedData);
    const { data: authData } = decryptString(encodedAuth);
    rawData = streamData ?? undefined;
    rawAuth = authData ?? undefined;
  } else {
    rawAuth = fromUrlSafeBase64(encodedAuth);
    rawData = fromUrlSafeBase64(encodedData);
  }

  if (!rawData || !rawAuth) {
    throw new APIError(
      constants.ErrorCode.ENCRYPTION_ERROR,
      undefined,
      'Could not decrypt data or auth'
    );
  }

  return {
    data: ProxyDataSchema.parse(JSON.parse(rawData)),
    auth: ProxyAuthSchema.parse(JSON.parse(rawAuth)),
  };
}

function assertProxyAccess(auth: ProxyAuth, requestId: string) {
  if (
    (!appConfig.bootstrap.auth?.has(auth.username) ||
      appConfig.bootstrap.auth?.get(auth.username) !== auth.password) &&
    (auth.username !== constants.PUBLIC_NZB_PROXY_USERNAME ||
      !appConfig.nzbProxy.publicEnabled)
  ) {
    logger.warn(`[${requestId}] Authentication failed`, {
      username: auth.username,
    });
    throw new APIError(
      constants.ErrorCode.UNAUTHORIZED,
      undefined,
      'Invalid auth'
    );
  }

  if (
    auth.username !== constants.PUBLIC_NZB_PROXY_USERNAME &&
    !canUseProxy(auth.username)
  ) {
    logger.warn(`[${requestId}] Proxy access denied`, {
      username: auth.username,
    });
    throw new APIError(
      constants.ErrorCode.FORBIDDEN,
      undefined,
      'Proxy access not permitted for this user'
    );
  }
}

async function serveProxyRequest(
  req: Request<any>,
  res: Response,
  next: NextFunction,
  auth: ProxyAuth,
  data: ProxyData,
  filename: string | undefined,
  requestId: string
) {
  const startTime = Date.now();
  let upstreamResponse: Dispatcher.ResponseData | undefined;
  let clientIp: string | undefined;

  try {
    assertProxyAccess(auth, requestId);

    clientIp =
      req.requestIp || req.ip || req.socket.remoteAddress || 'unknown';
    const timestamp = Date.now();

    const connectionLimit =
      appConfig.bootstrap.authConnectionLimits?.get(auth.username) ??
      appConfig.bootstrap.authConnectionLimits?.get('*') ??
      0;

    const clientHeaders = copyHeaders(req.headers);

    const isBodyRequest =
      req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH';
    const isGetRequest = req.method === 'GET';

    let sizeLimiter;
    let bytesRead = 0;
    if (auth.username === constants.PUBLIC_NZB_PROXY_USERNAME) {
      if (appConfig.nzbProxy.maxSize > 0) {
        sizeLimiter = new Transform({
          transform(chunk, encoding, callback) {
            bytesRead += chunk.length;

            if (bytesRead > appConfig.nzbProxy.maxSize) {
              callback(new Error('Content too large'));
            } else {
              callback(null, chunk);
            }
          },
        });
      }
      if (data.type !== 'nzb') {
        logger.warn(
          `[${requestId}] Public NZB proxy can only be used for NZB files`,
          { dataType: data.type }
        );
        next(
          new APIError(
            constants.ErrorCode.FORBIDDEN,
            undefined,
            'Public NZB proxy can only be used for NZB files'
          )
        );
        return;
      }
    }

    if (isGetRequest) {
      if (connectionLimit > 0) {
        const activeConnections = await proxyStats.getActiveConnections(
          auth.username
        );
        if (activeConnections.length >= connectionLimit) {
          logger.warn(`[${requestId}] Connection limit reached`, {
            username: auth.username,
            clientIp,
            connectionLimit,
          });
          res
            .status(302)
            .redirect(`/static/${StaticFiles.CONTENT_PROXY_LIMIT_REACHED}`);
          return;
        }
      }
      proxyStats
        .addConnection(
          auth.username,
          clientIp,
          data.url,
          timestamp,
          requestId,
          filename
        )
        .catch((error) =>
          logger.warn(`[${requestId}] Failed to add connection to stats`, {
            error: error instanceof Error ? error.message : String(error),
          })
        );
    }

    const upstreamStartTime = Date.now();
    let currentUrl = data.url;

    const INTERNAL_FORWARDED_PARAMS = ['fbk'] as const;
    if (appConfig.bootstrap.baseUrl) {
      try {
        const upstreamUrlObj = new URL(currentUrl);
        if (
          upstreamUrlObj.origin ===
          new URL(appConfig.bootstrap.baseUrl).origin
        ) {
          let forwarded = false;
          for (const param of INTERNAL_FORWARDED_PARAMS) {
            const val = req.query[param];
            if (val && typeof val === 'string') {
              upstreamUrlObj.searchParams.set(param, val);
              forwarded = true;
            }
          }
          if (forwarded) currentUrl = upstreamUrlObj.toString();
        }
      } catch {
        // ignore malformed URLs
      }
    }

    const maxRedirects = 10;
    let redirectCount = 0;
    let method = req.method as Dispatcher.HttpMethod;

    while (redirectCount < maxRedirects) {
      const urlObj = new URL(currentUrl);
      if (
        appConfig.bootstrap.baseUrl &&
        urlObj.origin === appConfig.bootstrap.baseUrl
      ) {
        const internalUrl = new URL(appConfig.bootstrap.internalUrl);
        urlObj.protocol = internalUrl.protocol;
        urlObj.host = internalUrl.host;
        urlObj.port = internalUrl.port;
      }

      if (appConfig.http.requestUrlMappings) {
        for (const [key, value] of Object.entries(
          appConfig.http.requestUrlMappings
        )) {
          if (urlObj.origin === key) {
            const mappedUrl = new URL(value);
            urlObj.protocol = mappedUrl.protocol;
            urlObj.host = mappedUrl.host;
            urlObj.port = mappedUrl.port;
            break;
          }
        }
      }
      const { useProxy, proxyIndex } = shouldProxy(urlObj);
      const proxyAgent = useProxy
        ? getProxyAgent(appConfig.http.addonProxy[proxyIndex])
        : undefined;
      const headers = Object.fromEntries(
        Object.entries({ ...clientHeaders, ...data.requestHeaders }).map(
          ([key, value]) => [key.toLowerCase(), value]
        )
      );
      const domainUserAgent = domainHasUserAgent(urlObj);
      if (domainUserAgent) {
        headers['user-agent'] = domainUserAgent;
      }
      if (urlObj.username && urlObj.password) {
        const basicAuth = Buffer.from(
          `${decodeURIComponent(urlObj.username)}:${decodeURIComponent(
            urlObj.password
          )}`
        ).toString('base64');
        headers['authorization'] = `Basic ${basicAuth}`;
        urlObj.username = '';
        urlObj.password = '';
      }
      currentUrl = urlObj.toString();
      logger.debug(`[${requestId}] Making upstream request`, {
        username: auth.username,
        method: method,
        tunneled: useProxy
          ? `true${proxyIndex > 1 ? ` (${proxyIndex + 1})` : ''}`
          : 'false',
        range: headers['range'],
        url: sanitiseUrlForLog(currentUrl),
      });
      logger.silly(`[${requestId}] Headers for upstream request`, {
        headers: JSON.stringify(headers),
      });
      upstreamResponse = await request(currentUrl, {
        method: method,
        headers: headers,
        dispatcher: proxyAgent,
        body: isBodyRequest ? req : undefined,
        bodyTimeout: 0,
        headersTimeout: 0,
      });

      if ([301, 302, 303, 307, 308].includes(upstreamResponse.statusCode)) {
        redirectCount++;
        const location = upstreamResponse.headers['location'];
        if (!location || typeof location !== 'string') {
          break;
        }
        currentUrl = new URL(location, currentUrl).href;

        if ([301, 302, 303].includes(upstreamResponse.statusCode)) {
          method = 'GET';
        }
        continue;
      }

      break;
    }

    if (!upstreamResponse) {
      logger.error(`[${requestId}] Upstream response not found`);
      if (!res.headersSent) {
        next(
          new APIError(
            constants.ErrorCode.INTERNAL_SERVER_ERROR,
            undefined,
            'Upstream response not found'
          )
        );
      }
      return;
    }
    const upstreamDuration = getTimeTakenSincePoint(upstreamStartTime);

    if (auth.username === constants.PUBLIC_NZB_PROXY_USERNAME) {
      if (appConfig.nzbProxy.maxSize > 0) {
        const contentLengthHeader = upstreamResponse.headers['content-length']
          ? Array.isArray(upstreamResponse.headers['content-length'])
            ? upstreamResponse.headers['content-length'][0]
            : upstreamResponse.headers['content-length']
          : undefined;
        const contentLength = contentLengthHeader
          ? parseInt(contentLengthHeader, 10)
          : 0;
        const maxSize = appConfig.nzbProxy.maxSize;
        if (maxSize > 0 && contentLength > maxSize) {
          logger.warn(`[${requestId}] Public NZB proxy size limit exceeded`, {
            contentLength,
            maxSize,
          });
          next(
            new APIError(
              constants.ErrorCode.FORBIDDEN,
              undefined,
              'Content size exceeds public NZB proxy limit'
            )
          );
          return;
        }
      }
    }

    res.set(sanitiseHeaders(upstreamResponse.headers));
    if (data.responseHeaders) {
      res.set(data.responseHeaders);
    }
    res.status(upstreamResponse.statusCode);

    logger.debug(`[${requestId}] Serving upstream response`, {
      username: auth.username,
      statusCode: upstreamResponse.statusCode,
      upstreamDuration,
      contentType: upstreamResponse.headers['content-type'],
      contentLength: upstreamResponse.headers['content-length'],
      contentRange: upstreamResponse.headers['content-range'],
      targetUrl: sanitiseUrlForLog(currentUrl),
    });

    if (req.method === 'HEAD') {
      res.end();
    } else {
      if (upstreamResponse.body.destroyed || res.destroyed) {
        logger.debug(`[${requestId}] Stream already destroyed, skipping pipe`, {
          upstreamDestroyed: upstreamResponse.body.destroyed,
          resDestroyed: res.destroyed,
        });
      } else {
        if (sizeLimiter) {
          await pipeline(upstreamResponse.body, sizeLimiter, res);
        } else {
          await pipeline(upstreamResponse.body, res);
        }
      }
    }

    logger.debug(`[${requestId}] Proxy connection closed`, {
      username: auth.username,
    });
  } catch (error) {
    const totalDuration = Date.now() - startTime;

    if (upstreamResponse && !upstreamResponse.body.destroyed) {
      upstreamResponse.body.on('error', (err) => {
        logger.warn(`[${requestId}] Failed to destroy upstream response body`, {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      upstreamResponse.body.destroy();
    }

    const errorCode = (error as NodeJS.ErrnoException)?.code;
    const isClientDisconnect =
      errorCode === 'ERR_STREAM_PREMATURE_CLOSE' ||
      errorCode === 'ERR_STREAM_UNABLE_TO_PIPE' ||
      errorCode === 'ECONNRESET' ||
      errorCode === 'EPIPE' ||
      errorCode === 'ERR_STREAM_DESTROYED' ||
      (error as Error)?.message?.includes('aborted') ||
      (error as Error)?.message?.includes('destroyed');

    if (!isClientDisconnect) {
      logger.error(`[${requestId}] Proxy request failed`, {
        error: error instanceof Error ? error.message : String(error),
        errorCode,
        durationMs: totalDuration,
        contentLength: upstreamResponse?.headers['content-length'],
        upstreamStatusCode: upstreamResponse?.statusCode,
      });
      if (!res.headersSent) {
        next(
          error instanceof APIError
            ? error
            : new APIError(
                constants.ErrorCode.INTERNAL_SERVER_ERROR,
                undefined,
                'Proxy request failed'
              )
        );
      }
    } else {
      logger.debug(`[${requestId}] Client disconnected`, {
        errorCode,
        durationMs: totalDuration,
      });
    }
  } finally {
    if (clientIp) {
      proxyStats
        .endConnection(auth.username, clientIp, data.url, requestId)
        .catch((statsError) =>
          logger.warn(`[${requestId}] Failed to end connection in stats`, {
            error: statsError,
          })
        );
    }
  }
}

router.post(
  '/aliases',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = CreateAliasSchema.parse(req.body ?? {});
      const username = (req as { user?: { username?: string } }).user?.username;
      const password = username
        ? appConfig.bootstrap.auth?.get(username)
        : undefined;
      if (!username || !password) {
        throw new APIError(
          constants.ErrorCode.UNAUTHORIZED,
          undefined,
          'No AIOSTREAMS_AUTH credentials for the current session user'
        );
      }

      const data = ProxyDataSchema.parse({
        url: body.url,
        filename: body.filename,
        type: body.type ?? 'stream',
        requestHeaders: body.requestHeaders,
        responseHeaders: body.responseHeaders,
      });
      const { id, created } = await ProxyAliasRepository.createOrUpdate(
        body.stableKey,
        {
          auth: { username, password },
          data,
        }
      );

      res.status(created ? 201 : 200).json({
        id,
        proxified_url: buildAliasUrl(id, data.filename),
      });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  '/aliases/:id',
  requireAdmin,
  async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
    try {
      const revoked = await ProxyAliasRepository.revoke(req.params.id);
      res.status(revoked ? 204 : 404).end();
    } catch (error) {
      next(error);
    }
  }
);

router.all(
  '/s/:id{/:filename}',
  async (
    req: Request<ProxyAliasParams>,
    res: Response,
    next: NextFunction
  ) => {
    const requestId = Math.random().toString(36).substring(7);
    try {
      const payload = await ProxyAliasRepository.getPayload(req.params.id);
      if (!payload) {
        res.status(404).json({ error: 'Proxy alias not found' });
        return;
      }
      await serveProxyRequest(
        req,
        res,
        next,
        payload.auth,
        ProxyDataSchema.parse(payload.data),
        req.params.filename ?? payload.data.filename,
        requestId
      );
    } catch (error) {
      next(error);
    }
  }
);

router.all(
  '/:encryptedAuthAndData{/:filename}',
  async (req: Request<ProxyParams>, res: Response, next: NextFunction) => {
    const requestId = Math.random().toString(36).substring(7);
    try {
      const { auth, data } = parseLegacyProxyPayload(
        req.params.encryptedAuthAndData
      );
      await serveProxyRequest(
        req,
        res,
        next,
        auth,
        data,
        req.params.filename,
        requestId
      );
    } catch (error) {
      logger.error(`[${requestId}] Decryption failed`);
      next(error);
    }
  }
);
