// tests/unit/auth.middleware.test.js
const { signToken, authRequired } = require('../../src/middleware/auth');

function mockReqRes(headers = {}) {
  const req = { headers };
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return { req, res };
}

describe('auth middleware', () => {
  test('signToken returns a JWT string', () => {
    const token = signToken({ sub: 'user-1' });
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // header.payload.signature
  });

  test('rejects request with no Authorization header', () => {
    const { req, res } = mockReqRes();
    const next = jest.fn();
    authRequired(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects request with invalid token', () => {
    const { req, res } = mockReqRes({ authorization: 'Bearer not-a-real-token' });
    const next = jest.fn();
    authRequired(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('accepts request with valid token and populates req.user', () => {
    const token = signToken({ sub: 'user-42', username: 'alice' });
    const { req, res } = mockReqRes({ authorization: `Bearer ${token}` });
    const next = jest.fn();
    authRequired(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.sub).toBe('user-42');
    expect(req.user.username).toBe('alice');
  });
});
