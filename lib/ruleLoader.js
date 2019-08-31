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

'use strict';

const proxyUtil = require('./util');
const path = require('path');
const fs = require('fs');
const request = require('request');

const cachePath = proxyUtil.getEzProxyPath('cache');

/**
 * download a file and cache
 *
 * @param {any} url
 * @returns {string} cachePath
 */
function cacheRemoteFile(url) {
  return new Promise((resolve, reject) => {
    request(url, (error, response, body) => {
      if (error) {
        return reject(error);
      } else if (response.statusCode !== 200) {
        return reject(`failed to load with a status code ${response.statusCode}`);
      } else {
        const fileCreatedTime = proxyUtil.formatDate(new Date(), 'YYYY_MM_DD_hh_mm_ss');
        const random = Math.ceil(Math.random() * 500);
        const fileName = `remote_rule_${fileCreatedTime}_r${random}.js`;
        const filePath = path.join(cachePath, fileName);
        fs.writeFileSync(filePath, body);
        resolve(filePath);
      }
    });
  });
}


/**
 * load a local npm module
 *
 * @param {any} filePath
 * @returns module
 */
function loadLocalPath(filePath) {
  return new Promise((resolve, reject) => {
    const ruleFilePath = path.resolve(process.cwd(), filePath);
    if (fs.existsSync(ruleFilePath)) {
      resolve(require(ruleFilePath));
    } else {
      resolve(require(filePath));
    }
  });
}


/**
 * load a module from url or local path
 *
 * @param {any} urlOrPath
 * @returns module
 */
function requireModule(urlOrPath) {
  return new Promise((resolve, reject) => {
    if (/^http/i.test(urlOrPath)) {
      resolve(cacheRemoteFile(urlOrPath));
    } else {
      resolve(urlOrPath);
    }
  }).then(localPath => loadLocalPath(localPath));
}

module.exports = {
  cacheRemoteFile,
  loadLocalPath,
  requireModule,
};
