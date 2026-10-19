'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { AnalyticsError, parseRange, fetchDashboard } = require('../server/analytics-data');
const { LoginError, credentialsMatch, createSession, validSession, sessionCookie, sameOriginPost, readLogin } = require('../server/analytics-auth');

function secureHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Vary', 'Cookie');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  // Native form POSTs need their same-site Origin; no-referrer turns it into null.
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
}

function sendError(res, status, code, message) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (code === 'VERCEL_RATE_LIMIT') res.setHeader('Retry-After', '60');
  res.end(JSON.stringify({ error: { code, message } }));
}

function dashboardCsp(html) {
  const hashes = Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script\s*>/gi), match => `'sha256-${createHash('sha256').update(match[1], 'utf8').digest('base64')}'`);
  return [
    "default-src 'none'", `script-src ${hashes.length ? hashes.join(' ') : "'none'"}`,
    "style-src 'unsafe-inline'", "img-src 'self' data:", "connect-src 'self'",
    "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'"
  ].join('; ');
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

async function sendHtml(res, file, status = 200, error = '') {
  // Vercel includes server/** relative to the function's project root.
  let html = await fs.readFile(path.join(process.cwd(), 'server', file), 'utf8');
  if (file === 'analytics-login.html') {
    html = html.replace('{{LOGIN_ERROR}}', escapeHtml(error)).replace('{{ERROR_HIDDEN}}', error ? '' : 'hidden');
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', dashboardCsp(html));
  res.end(html);
}

function redirectToAnalytics(res) {
  res.statusCode = 303;
  res.setHeader('Location', '/analytics');
  res.end();
}

module.exports = async function analytics(req, res) {
  secureHeaders(res);
  const password = process.env.ANALYTICS_PASSWORD;
  if (!password) return sendError(res, 503, 'ANALYTICS_NOT_CONFIGURED', 'Доступ к аналитике закрыт: настройте серверную переменную ANALYTICS_PASSWORD в Vercel.');
  const settings = { username: process.env.ANALYTICS_USERNAME || 'admin', password };
  try {
    const url = new URL(req.url, 'https://analytics.internal');
    if (req.method === 'POST') {
      const action = url.searchParams.get('action');
      if (url.searchParams.getAll('action').length !== 1 || [...url.searchParams.keys()].some(key => key !== 'action') || !['login', 'logout'].includes(action)) {
        return sendError(res, 400, 'INVALID_ACTION', 'Неизвестное действие.');
      }
      if (!sameOriginPost(req)) return sendError(res, 403, 'INVALID_ORIGIN', 'Откройте форму входа на этом сайте.');
      if (action === 'logout') {
        res.setHeader('Set-Cookie', sessionCookie('', true));
        return redirectToAnalytics(res);
      }
      try {
        const credentials = await readLogin(req);
        if (!credentialsMatch(credentials.username, credentials.password, settings)) {
          res.setHeader('Set-Cookie', sessionCookie('', true));
          return await sendHtml(res, 'analytics-login.html', 401, 'Неверный логин или пароль. Попробуйте ещё раз.');
        }
      } catch (error) {
        if (error instanceof LoginError) return await sendHtml(res, 'analytics-login.html', error.status, error.message);
        throw error;
      }
      res.setHeader('Set-Cookie', sessionCookie(createSession(settings)));
      return redirectToAnalytics(res);
    }
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET, POST');
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Поддерживаются GET и отправка формы POST.');
    }
    if (!validSession(req.headers?.cookie, settings)) {
      if (url.searchParams.has('data')) return sendError(res, 401, 'UNAUTHORIZED', 'Войдите в аналитику, чтобы открыть данные.');
      return await sendHtml(res, 'analytics-login.html');
    }
    if (url.searchParams.has('data')) {
      const range = parseRange(url.searchParams);
      const data = await fetchDashboard(range);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify(data));
    }
    return await sendHtml(res, 'analytics-dashboard.html');
  } catch (error) {
    if (error instanceof AnalyticsError) return sendError(res, error.status, error.code, error.message);
    return sendError(res, 500, 'ANALYTICS_ERROR', 'Не удалось открыть аналитику. Проверьте настройки deployment.');
  }
};
