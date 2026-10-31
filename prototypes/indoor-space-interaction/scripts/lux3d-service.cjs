'use strict';

/*
 * Small local-only Lux3D adapter for the indoor prototype.
 * Credentials are read at request time from LUX3D_CN_API_KEY and are never
 * written to disk, returned to the browser, or included in diagnostics.
 */
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');

const BASE_URL = 'https://api.aholo3d.cn';
const MAX_JSON = 12 * 1024 * 1024;
const MAX_IMAGE = 12 * 1024 * 1024;
const POLL_INTERVAL_MS = 5000;
const POLL_ATTEMPTS = 36;

function safeJson(res, status, payload) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function localRequest(req) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return false;
  try {
    const base = new URL(`http://${req.headers.host}`);
    const origin = new URL(req.headers.origin || '');
    return ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
      && Number(base.port || 80) === req.socket.localPort
      && origin.origin === base.origin
      && origin.protocol === 'http:'
      && (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin');
  } catch {
    return false;
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_JSON) {
        reject(Object.assign(new Error('请求图片过大，请先压缩平面图家具裁剪图。'), {status: 413}));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.once('error', reject);
    req.once('end', () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(value && typeof value === 'object' ? value : {});
      } catch {
        reject(Object.assign(new Error('Lux3D 请求体不是有效 JSON。'), {status: 400}));
      }
    });
  });
}

function decodeImage(value, mimeType = 'image/png') {
  if (typeof value !== 'string' || !value) throw Object.assign(new Error('缺少家具裁剪图。'), {status: 400});
  const match = value.match(/^data:([^;,]+)?;base64,([\s\S]+)$/);
  const buffer = match ? Buffer.from(match[2], 'base64') : Buffer.from(value, 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE) throw Object.assign(new Error('家具裁剪图为空或超过 12 MB。'), {status: 413});
  const type = (match && match[1]) || mimeType || 'image/png';
  if (!/^image\/(png|jpeg|jpg|webp)$/i.test(type)) throw Object.assign(new Error('仅支持 PNG、JPEG 或 WEBP 家具裁剪图。'), {status: 400});
  return {buffer, type};
}

function apiKey() {
  const value = String(process.env.LUX3D_CN_API_KEY || '').trim();
  if (!value) throw Object.assign(new Error('未配置 Lux3D 国内区密钥。请在启动服务前设置 LUX3D_CN_API_KEY。'), {status: 503});
  return value;
}

async function jsonResponse(response, label) {
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`${label}返回了非 JSON 响应。`); }
  if (!response.ok) throw new Error(`${label}请求失败（HTTP ${response.status}）。`);
  if (data && data.f !== undefined && Number(data.f) !== 0) throw new Error(`${label}被接口拒绝。`);
  return data?.d === undefined ? data : data.d;
}

async function uploadImage(buffer, mimeType, key) {
  const tokenResponse = await fetch(`${BASE_URL}/asset/v1/token`, {headers: {Authorization: key}});
  const token = await jsonResponse(tokenResponse, 'Lux3D Asset token');
  const globalDomain = String(token.globalDomain || '').replace(/\/$/, '');
  const ousToken = String(token.ousToken || '');
  if (!/^https:\/\//.test(globalDomain) || !ousToken) throw new Error('Lux3D Asset token 响应缺少上传参数。');
  const digest = crypto.createHash('md5').update(buffer).digest('hex');
  const form = new FormData();
  form.append('file', new Blob([buffer], {type: mimeType}), `furniture-${digest}.png`);
  form.append('md5', digest);
  const uploadResponse = await fetch(`${globalDomain}/ous/api/v2/single/upload`, {
   method: 'POST', headers: {'ous-token-v2': ousToken}, body: form,
  });
  await jsonResponse(uploadResponse, 'Lux3D Asset upload');
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    const statusResponse = await fetch(`${globalDomain}/ous/api/v2/upload/status`, {headers: {'ous-token-v2': ousToken}});
    const status = await jsonResponse(statusResponse, 'Lux3D Asset status');
    if (Number(status.status) === 5 || status.status === 'SUCCESS') {
      if (typeof status.url === 'string' && /^https?:\/\//.test(status.url)) return status.url;
      throw new Error('Lux3D Asset 上传成功但没有返回图片 URL。');
    }
    if ([6, 8, 'FAILED', 'FAIL'].includes(status.status)) throw new Error('Lux3D Asset 上传失败。');
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('Lux3D Asset 上传超时。');
}

async function createTask(imageUrl, key, prompt) {
  const payload = {img: imageUrl, version: 'G1-Turbo', outputFormat: ['glb'], enablePbr: true};
  if (prompt) payload.prompt = String(prompt).slice(0, 500);
  const response = await fetch(`${BASE_URL}/lux3d/v1/generate/img-to-3d/task/create`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Authorization: key},
    body: JSON.stringify(payload),
  });
  const data = await jsonResponse(response, 'Lux3D 生成');
  const taskId = data?.taskId ?? data?.bizId ?? data;
  if (!taskId) throw new Error('Lux3D 没有返回任务 ID。');
  return String(taskId);
}

async function pollTask(taskId, key) {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    const response = await fetch(`${BASE_URL}/lux3d/v1/generate/task/get?taskid=${encodeURIComponent(taskId)}`, {headers: {Authorization: key}});
    const data = await jsonResponse(response, 'Lux3D 任务查询');
    const status = Number(data?.status);
    if (status === 3) {
      const output = Array.isArray(data.outputs) ? data.outputs.find(item => item && typeof item.content === 'string') : null;
      if (!output) throw new Error('Lux3D 任务成功但没有返回 GLB 地址。');
      return output.content;
    }
    if ([4, 5, 6].includes(status)) throw new Error(`Lux3D 生成任务失败（状态 ${status}）。`);
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('Lux3D 生成任务超时，保留任务 ID 供后续查询。');
}

async function downloadGlb(url, output) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Lux3D GLB 下载失败（HTTP ${response.status}）。`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 20 || buffer.subarray(0, 4).toString('ascii') !== 'glTF') throw new Error('Lux3D 返回的文件不是有效 GLB。');
  const temp = `${output}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(temp, buffer, {flag: 'wx'});
  await fsp.rename(temp, output);
  return buffer.length;
}

function createLux3dService(appRoot, {endpoint = '/__lux3d_generate__'} = {}) {
  const cacheRoot = path.join(appRoot, '.cache', 'lux3d');
  let active = false;
  function ready() { return Boolean(String(process.env.LUX3D_CN_API_KEY || '').trim()); }
  async function handle(req, res) {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); safeJson(res, 405, {error: 'Lux3D 生成仅接受 POST。'}); return; }
    if (!localRequest(req)) { req.resume(); safeJson(res, 403, {error: '仅允许本机应用调用 Lux3D。'}); return; }
    if (active) { res.setHeader('Retry-After', '5'); safeJson(res, 503, {error: '已有一个 Lux3D 任务在生成，请稍后重试。'}); return; }
    if (String(process.env.LUX3D_ALLOW_BILLABLE || '') !== '1') { safeJson(res, 412, {error: 'Lux3D 生成可能消耗额度。确认后请设置 LUX3D_ALLOW_BILLABLE=1 再启动服务。'}); return; }
    active = true;
    try {
      const body = await readJson(req);
      const {buffer, type} = decodeImage(body.imageBase64, body.mimeType);
      const key = apiKey();
      await fsp.mkdir(cacheRoot, {recursive: true});
      const imageUrl = await uploadImage(buffer, type, key);
      const taskId = await createTask(imageUrl, key, body.prompt);
      const resultUrl = await pollTask(taskId, key);
      const digest = crypto.createHash('sha256').update(resultUrl).digest('hex').slice(0, 24);
      const fileName = `${digest}.glb`, target = path.join(cacheRoot, fileName);
      let size = 0;
      try { size = (await fsp.stat(target)).size; } catch { size = await downloadGlb(resultUrl, target); }
      safeJson(res, 200, {taskId, url: `/__lux3d_assets__/${fileName}`, bytes: size, format: 'glb'});
    } catch (error) {
      safeJson(res, error.status || 502, {error: error.message || 'Lux3D 生成失败。'});
    } finally { active = false; }
  }
  return {handle, ready, get busy() { return active; }, endpoint, cacheRoot};
}

module.exports = {createLux3dService, localRequest, BASE_URL};
