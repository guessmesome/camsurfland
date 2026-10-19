'use strict';

const { createHash, createHmac, randomBytes, timingSafeEqual } = require('node:crypto');

const COOKIE_NAME = '__Host-camsurfland_analytics';
const SESSION_SECONDS = 8 * 60 * 60;
const MAX_FORM_BYTES = 8192;

class LoginError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function credentialsMatch(username, password, settings) {
  const digest = value => createHash('sha256').update(value, 'utf8').digest();
  const userMatches = timingSafeEqual(digest(username), digest(settings.username));
  const passwordMatches = timingSafeEqual(digest(password), digest(settings.password));
  return Boolean(userMatches & passwordMatches);
}

function signature(value, settings) {
  const key = createHmac('sha256', settings.password)
    .update('camsurfland-analytics-session-v1\0').update(settings.username).digest();
  return createHmac('sha256', key).update(value).digest();
}

function createSession(settings, now = Date.now()) {
  const issued = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, iat: issued, exp: issued + SESSION_SECONDS, nonce: randomBytes(24).toString('base64url') })).toString('base64url');
  return `${payload}.${signature(payload, settings).toString('base64url')}`;
}

function validSession(header, settings, now = Date.now()) {
  if (typeof header !== 'string' || header.length > 8192) return false;
  const matches = header.split(';').map(item => item.trim()).filter(item => item.startsWith(`${COOKIE_NAME}=`));
  if (matches.length !== 1) return false;
  const value = matches[0].slice(COOKIE_NAME.length + 1);
  if (value.length > 512 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const [encoded, signed] = value.split('.');
  const supplied = Buffer.from(signed, 'base64url');
  if (supplied.length !== 32 || supplied.toString('base64url') !== signed || !timingSafeEqual(supplied, signature(encoded, settings))) return false;
  try {
    const bytes = Buffer.from(encoded, 'base64url');
    if (bytes.toString('base64url') !== encoded) return false;
    const session = JSON.parse(bytes.toString('utf8'));
    const seconds = Math.floor(now / 1000);
    return session.v === 1 && Number.isSafeInteger(session.iat) && Number.isSafeInteger(session.exp)
      && session.iat <= seconds + 60 && session.exp > seconds && session.exp - session.iat === SESSION_SECONDS
      && typeof session.nonce === 'string' && /^[A-Za-z0-9_-]{32}$/.test(session.nonce);
  } catch { return false; }
}

function sessionCookie(value, clear = false) {
  return `${COOKIE_NAME}=${clear ? '' : value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${clear ? 0 : SESSION_SECONDS}`;
}

function sameOriginPost(req) {
  const host = req.headers?.host;
  if (typeof host !== 'string' || !/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  const referrer = req.headers.referer;
  if (typeof origin !== 'string' && typeof referrer !== 'string') return false;
  try {
    const url = new URL(typeof origin === 'string' ? origin : referrer);
    return url.protocol === 'https:' && url.host.toLowerCase() === host.toLowerCase()
      && (typeof origin !== 'string' || origin === url.origin);
  } catch { return false; }
}

async function readLogin(req) {
  const contentType = req.headers?.['content-type'];
  if (typeof contentType !== 'string' || contentType.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') {
    throw new LoginError(415, 'INVALID_LOGIN_FORMAT', 'Отправьте логин и пароль через форму входа.');
  }
  const length = req.headers['content-length'];
  if (length !== undefined && (typeof length !== 'string' || !/^\d+$/.test(length) || Number(length) > MAX_FORM_BYTES)) {
    throw new LoginError(413, 'LOGIN_TOO_LARGE', 'Слишком длинные данные входа.');
  }
  let body = req.body;
  if (body === undefined) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_FORM_BYTES) throw new LoginError(413, 'LOGIN_TOO_LARGE', 'Слишком длинные данные входа.');
      chunks.push(bytes);
    }
    body = Buffer.concat(chunks);
  }
  let username;
  let password;
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    if (Buffer.byteLength(body) > MAX_FORM_BYTES) throw new LoginError(413, 'LOGIN_TOO_LARGE', 'Слишком длинные данные входа.');
    const params = new URLSearchParams(body.toString());
    if ([...params.keys()].some(key => !['username', 'password'].includes(key)) || params.getAll('username').length !== 1 || params.getAll('password').length !== 1) {
      throw new LoginError(400, 'INVALID_LOGIN', 'Введите логин и пароль.');
    }
    username = params.get('username');
    password = params.get('password');
  } else if (body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).every(key => ['username', 'password'].includes(key))) {
    // Vercel's Node runtime may already parse an URL-encoded request body.
    username = body.username;
    password = body.password;
  }
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password || username.length > 256 || password.length > 2048) {
    throw new LoginError(400, 'INVALID_LOGIN', 'Введите логин и пароль.');
  }
  return { username, password };
}

module.exports = { COOKIE_NAME, SESSION_SECONDS, LoginError, credentialsMatch, createSession, validSession, sessionCookie, sameOriginPost, readLogin };
