/*
Modified work Copyright [2019] [Abhimanyu Pandian]

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

const ws = require('ws');
const logUtil = require('./log.js');

const WsServer = ws.Server;

/**
* get a new websocket server based on the server
* @param @required {object} config
                   {string} config.server
                   {handler} config.handler
*/
function getWsServer(config) {
  const wss = new WsServer({
    server: config.server
  });

  wss.on('connection', config.connHandler);

  wss.on('headers', (headers) => {
    headers.push('x-proxy-websocket:true');
  });

  wss.on('error', e => {
    logUtil.error(`error in websocket proxy: ${e.message},\r\n ${e.stack}`);
    console.error('error happened in proxy websocket:', e)
  });

  wss.on('close', e => {
    console.error('==> closing the ws server');
  });

  return wss;
}

module.exports.getWsServer = getWsServer;
