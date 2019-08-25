
const path = require('path');

const USER_HOME = process.env.HOME || process.env.USERPROFILE;
const DEFAULT_EZPROXY_HOME = path.join(USER_HOME, '/.ezproxy/');

module.exports.getEzProxyHome = function () {
  const ENV_EZPROXY_HOME = process.env.EZPROXY_HOME || '';
  return ENV_EZPROXY_HOME || DEFAULT_EZPROXY_HOME;
}
