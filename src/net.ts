import * as http from 'http';
import * as https from 'https';
import * as zlib from 'zlib';
import { URL } from 'url';
import { CookieJar } from 'tough-cookie';

export interface RequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: Buffer | string;
  jar?: CookieJar;
  maxRedirects?: number;
  timeoutMs?: number;
}

export interface HttpResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  finalUrl: string;
}

function decodeBody(body: Buffer, encoding: string | undefined): Buffer {
  if (!encoding) {
    return body;
  }
  if (encoding === 'gzip') {
    return zlib.gunzipSync(body);
  }
  if (encoding === 'deflate') {
    return zlib.inflateSync(body);
  }
  if (encoding === 'br') {
    return zlib.brotliDecompressSync(body);
  }
  return body;
}

export function request(opts: RequestOptions): Promise<HttpResponse> {
  const maxRedirects = opts.maxRedirects ?? 5;
  return new Promise((resolve, reject) => {
    const doRequest = (
      currentUrl: string,
      redirectsLeft: number,
      method: string,
      body?: Buffer | string
    ): void => {
      let url: URL;
      try {
        url = new URL(currentUrl);
      } catch (err) {
        reject(err);
        return;
      }

      const mod = url.protocol === 'http:' ? http : https;
      const headers: Record<string, string> = { ...opts.headers };
      headers['Accept-Encoding'] = headers['Accept-Encoding'] ?? 'gzip, deflate, br';
      if (body) {
        headers['Content-Length'] = String(Buffer.byteLength(body));
      } else {
        delete headers['Content-Length'];
      }
      if (opts.jar) {
        const cookies = opts.jar.getCookieStringSync(currentUrl);
        if (cookies) {
          headers['Cookie'] = cookies;
        }
      }

      const req = mod.request(url, { method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk as Buffer));
        res.on('end', () => {
          let responseBody: Buffer<ArrayBufferLike> = Buffer.concat(chunks);
          const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
          try {
            responseBody = decodeBody(responseBody, encoding);
          } catch {
            // Pass the original bytes through if decompression fails.
          }

          if (opts.jar && res.headers['set-cookie']) {
            for (const cookie of res.headers['set-cookie']) {
              try {
                opts.jar.setCookieSync(cookie, currentUrl);
              } catch {
                // Ignore malformed cookies.
              }
            }
          }

          const status = res.statusCode ?? 0;
          const location = res.headers.location;
          const isRedirect = status >= 300 && status < 400 && location;
          if (isRedirect && redirectsLeft > 0 && location) {
            const next = new URL(location, currentUrl).toString();
            const nextMethod =
              status === 303 || (method === 'POST' && (status === 301 || status === 302))
                ? 'GET'
                : method;
            doRequest(
              next,
              redirectsLeft - 1,
              nextMethod,
              nextMethod === 'GET' ? undefined : body
            );
            return;
          }

          resolve({
            statusCode: status,
            headers: res.headers,
            body: responseBody,
            finalUrl: currentUrl,
          });
        });
      });

      req.on('error', reject);
      req.setTimeout(opts.timeoutMs ?? 30000, () => {
        req.destroy(new Error(`Request timed out after ${opts.timeoutMs ?? 30000} ms`));
      });
      if (body) {
        req.write(body);
      }
      req.end();
    };

    doRequest(opts.url, maxRedirects, opts.method ?? 'GET', opts.body);
  });
}
