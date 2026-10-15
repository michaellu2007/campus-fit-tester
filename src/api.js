// HTTP 传输 + 端点调用。URL 全部来自 config，组包交给 protocol.js。
const https = require('https');
const url = require('url');
const protocol = require('./protocol');

function post(fullUrl, body, token, ua) {
  const payload = JSON.stringify(protocol.envelope(body, token));
  const options = Object.assign(url.parse(fullUrl), {
    method: 'POST',
    headers: protocol.httpHeaders(payload, ua),
    timeout: 15000,
  });
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let buf = '';
      res.on('data', c => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

// 端点 URL 拼接：config.server.baseUrl + config.server.endpoints.<name>
function endpoint(config, name) {
  const base = config.server.baseUrl.replace(/\/+$/, '');
  const path = config.server.endpoints[name];
  if (!path) throw new Error(`config.server.endpoints.${name} 未配置（参考 docs/CONFIG.md）`);
  return base + path;
}

module.exports = { post, endpoint };
