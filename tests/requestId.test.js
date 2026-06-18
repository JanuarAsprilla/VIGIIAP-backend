import { describe, it, expect } from 'vitest';
import { requestId } from '../src/middlewares/requestId.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeReqRes(headers = {}) {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; } };
  return [{ headers, requestId: undefined }, res, () => {}];
}

describe('requestId middleware', () => {
  it('genera UUID v4 si el cliente no envía X-Request-Id', () => {
    const [req, res, next] = makeReqRes();
    requestId(req, res, next);
    expect(req.requestId).toMatch(UUID_REGEX);
    expect(res.headers['X-Request-Id']).toBe(req.requestId);
  });

  it('reutiliza el ID del cliente si viene en el header', () => {
    const [req, res, next] = makeReqRes({ 'x-request-id': 'client-id-abc' });
    requestId(req, res, next);
    expect(req.requestId).toBe('client-id-abc');
    expect(res.headers['X-Request-Id']).toBe('client-id-abc');
  });

  it('llama a next()', () => {
    let called = false;
    const [req, res] = makeReqRes();
    requestId(req, res, () => { called = true; });
    expect(called).toBe(true);
  });

  it('genera IDs únicos en cada request', () => {
    const [req1, res1, next1] = makeReqRes();
    const [req2, res2, next2] = makeReqRes();
    requestId(req1, res1, next1);
    requestId(req2, res2, next2);
    expect(req1.requestId).not.toBe(req2.requestId);
  });
});
