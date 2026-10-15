// ★线上格式模块★ —— 唯一描述请求/响应线上格式的地方。
// 换一套结构相似的服务端，只改这个文件；session/api/track 无需改动。
//
// 信封约定（这类系统的公开可观察协议）：
//   1) 业务体 body 与 header 分离：{ body: {...}, header: { token, snTime, sn, from } }
//   2) sn = md5( 按 key 字典序拼 "k=v&k=v" )，签名域含 snTime/token
//   3) 整包 JSON 的 md5 放进 HTTP 头 X-Sn-Verify
//   4) 提交体含加密三件套：sign = Base64(HMAC-SHA256(recordId + 距离, encryptKey))
const crypto = require('crypto');

const md5 = s => crypto.createHash('md5').update(s, 'utf8').digest('hex');

module.exports = {
  constants: {
    from: 'wx',
    accept: '*/*;',
    contentType: 'application/json; charset=UTF-8',
  },

  // 业务体 + token → 完整请求信封
  envelope(body, token) {
    const snTime = Date.now();
    const all = Object.assign({ snTime, token }, body);
    const sn = md5(Object.keys(all).sort().map(k => `${k}=${all[k]}`).join('&'));
    return { body, header: { token, snTime, sn, from: this.constants.from } };
  },

  // 整包 JSON 的防篡改头
  verifyHeader(payloadJson) {
    return { 'X-Sn-Verify': md5(payloadJson) };
  },

  // HTTP 头（User-Agent 由调用方注入）
  httpHeaders(payloadJson, ua) {
    return Object.assign({
      'Accept': this.constants.accept,
      'Content-Type': this.constants.contentType,
      'User-Agent': ua,
      'Content-Length': Buffer.byteLength(payloadJson),
    }, this.verifyHeader(payloadJson));
  },

  // 提交体加密三件套（encryptKey 来自小程序 wx.getUserCryptoManager）
  submitSignature(recordId, distance, encryptKey) {
    return {
      sign: crypto.createHmac('sha256', Buffer.from(encryptKey, 'utf8'))
        .update(String(recordId) + String(distance), 'utf8').digest('base64'),
    };
  },

  // 响应宽容解析：顶层 detail 优先，data.detail 兜底（不同服务端实现不一样）
  detail(json) {
    return json.detail || (json.data && json.data.detail) || {};
  },
};
