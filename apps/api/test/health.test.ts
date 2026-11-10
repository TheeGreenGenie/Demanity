import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildApp, serializeRequest } from '../src/app.js';
import { loadConfig } from '../src/config.js';

describe('GET /health', () => {
  it('returns ok', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});

describe('privacy: request logging', () => {
  it('serializer keeps only method and url', () => {
    const fakeRequest = {
      method: 'GET',
      url: '/health',
      ip: '203.0.113.7',
      headers: { 'x-forwarded-for': '198.51.100.9', cookie: 'secret' },
    };
    expect(serializeRequest(fakeRequest)).toEqual({ method: 'GET', url: '/health' });
  });

  it('never writes IP addresses or headers to the log stream', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const app = await buildApp({
      logger: { level: 'info', stream, serializers: { req: serializeRequest } },
    });
    await app.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: '203.0.113.7',
      headers: { 'x-forwarded-for': '198.51.100.9', cookie: 'session=secret' },
    });
    await app.close();

    const output = lines.join('\n');
    expect(output).toContain('/health'); // logging actually happened
    expect(output).not.toContain('203.0.113.7');
    expect(output).not.toContain('198.51.100.9');
    expect(output).not.toContain('secret');
    expect(output).not.toContain('remoteAddress');
  });
});

describe('config', () => {
  it('uses safe defaults', () => {
    expect(loadConfig({})).toMatchObject({ host: '127.0.0.1', port: 3000, nodeEnv: 'development' });
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ API_PORT: 'abc' })).toThrow(/API_PORT/);
  });

  it('rejects an invalid NODE_ENV', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
