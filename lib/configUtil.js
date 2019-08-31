/*
Modified work Copyright 2019 Abhimanyu Pandian

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

const path = require('path');

const USER_HOME = process.env.HOME || process.env.USERPROFILE;
const DEFAULT_EZPROXY_HOME = path.join(USER_HOME, '/.ezproxy/');

module.exports.getEzProxyHome = function () {
  const ENV_EZPROXY_HOME = process.env.EZPROXY_HOME || '';
  return ENV_EZPROXY_HOME || DEFAULT_EZPROXY_HOME;
}
