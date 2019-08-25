'use strict';

const http = require('http'),
  https = require('https'),
  async = require('async'),
  color = require('colorful'),
  systemProxyMgr = require('./lib/systemProxyMgr'),
  certMgr = require('./lib/certMgr'),
  Recorder = require('./lib/recorder'),
  logUtil = require('./lib/log'),
  util = require('./lib/util'),
  events = require('events'),
  co = require('co'),
  wsServerMgr = require('./lib/wsServerMgr'),
  ThrottleGroup = require('stream-throttle').ThrottleGroup,
  exec = require('child_process').exec,
  onChange = require('on-change'),
  fs = require('fs'),
  utils = require('util'),
  convert = require('binstring');

// var log_file = fs.createWriteStream('/debug.log', { flags: 'w' });
// var log_stdout = process.stdout;

// console.log = function (d) {
//    log_file.write(utils.format(d) + '\n');
//    log_stdout.write(utils.format(d) + '\n');
// };

// const memwatch = require('memwatch-next');

// setInterval(() => {
//   console.log(process.memoryUsage());
//   const rss = Math.ceil(process.memoryUsage().rss / 1000 / 1000);
//   console.log('Program is using ' + rss + ' mb of Heap.');
// }, 1000);

// memwatch.on('stats', (info) => {
//   console.log('gc !!');
//   console.log(process.memoryUsage());
//   const rss = Math.ceil(process.memoryUsage().rss / 1000 / 1000);
//   console.log('GC !! Program is using ' + rss + ' mb of Heap.');

//   // var heapUsed = Math.ceil(process.memoryUsage().heapUsed / 1000);
//   // console.log("Program is using " + heapUsed + " kb of Heap.");
//   // console.log(info);
// });

const T_TYPE_HTTP = 'http',
  T_TYPE_HTTPS = 'https',
  DEFAULT_TYPE = T_TYPE_HTTP;

const PROXY_STATUS_INIT = 'INIT';
const PROXY_STATUS_READY = 'READY';
const PROXY_STATUS_CLOSED = 'CLOSED';

/**
 *
 * @class ProxyCore
 * @extends {events.EventEmitter}
 */
class ProxyCore extends events.EventEmitter {

  /**
   * Creates an instance of ProxyCore.
   *
   * @param {object} config - configs
   * @param {number} config.port - port of the proxy server
   * @param {object} [config.rule=null] - rule module to use
   * @param {string} [config.type=http] - type of the proxy server, could be 'http' or 'https'
   * @param {strign} [config.hostname=localhost] - host name of the proxy server, required when this is an https proxy
   * @param {number} [config.throttle] - speed limit in kb/s
   * @param {boolean} [config.forceProxyHttps=false] - if proxy all https requests
   * @param {boolean} [config.silent=false] - if keep the console silent
   * @param {boolean} [config.dangerouslyIgnoreUnauthorized=false] - if ignore unauthorized server response
   * @param {object} [config.recorder] - recorder to use
   * @param {boolean} [config.wsIntercept] - whether intercept websocket
   *
   * @memberOf ProxyCore
   */
  constructor(config) {
    super();
    config = config || {};

    this.status = PROXY_STATUS_INIT;
    this.proxyPort = config.port;
    this.proxyType = /https/i.test(config.type || DEFAULT_TYPE) ? T_TYPE_HTTPS : T_TYPE_HTTP;
    this.proxyHostName = config.hostname || 'localhost';
    this.recorder = config.recorder;

    if (parseInt(process.versions.node.split('.')[0], 10) < 4) {
      throw new Error('node.js >= v4.x is required for ezproxy');
    } else if (config.forceProxyHttps && !certMgr.ifRootCAFileExists()) {
      logUtil.printLog('You can run `ezproxy-ca` to generate one root CA and then re-run this command');
      throw new Error('root CA not found. Please run `ezproxy-ca` to generate one first.');
    } else if (this.proxyType === T_TYPE_HTTPS && !config.hostname) {
      throw new Error('hostname is required in https proxy');
    } else if (!this.proxyPort) {
      throw new Error('proxy port is required');
    } else if (!this.recorder) {
      throw new Error('recorder is required');
    } else if (config.forceProxyHttps && config.rule && config.rule.beforeDealHttpsRequest) {
      logUtil.printLog('both "-i(--intercept)" and rule.beforeDealHttpsRequest are specified, the "-i" option will be ignored.', logUtil.T_WARN);
      config.forceProxyHttps = false;
    }

    this.httpProxyServer = null;
    this.requestHandler = null;

    // copy the rule to keep the original proxyRule independent
    this.proxyRule = config.rule || {};

    if (config.silent) {
      logUtil.setPrintStatus(false);
    }

    if (config.throttle) {
      logUtil.printLog('throttle :' + config.throttle + 'kb/s');
      const rate = parseInt(config.throttle, 10);
      if (rate < 1) {
        throw new Error('Invalid throttle rate value, should be positive integer');
      }
      global._throttle = new ThrottleGroup({ rate: 1024 * rate }); // rate - byte/sec
    }

    // init recorder
    this.recorder = config.recorder;

    // init request handler
    const RequestHandler = util.freshRequire('./requestHandler');
    this.requestHandler = new RequestHandler({
      wsIntercept: config.wsIntercept,
      httpServerPort: config.port, // the http server port for http proxy
      forceProxyHttps: !!config.forceProxyHttps,
      dangerouslyIgnoreUnauthorized: !!config.dangerouslyIgnoreUnauthorized
    }, this.proxyRule, this.recorder);
  }

  /**
  * manage all created socket
  * for each new socket, we put them to a map;
  * if the socket is closed itself, we remove it from the map
  * when the `close` method is called, we'll close the sockes before the server closed
  *
  * @param {Socket} the http socket that is creating
  * @returns undefined
  * @memberOf ProxyCore
  */
  handleExistConnections(socket) {
    const self = this;
    self.socketIndex ++;
    const key = `socketIndex_${self.socketIndex}`;
    self.socketPool[key] = socket;

    // if the socket is closed already, removed it from pool
    socket.on('close', () => {
      delete self.socketPool[key];
    });
  }
  /**
   * start the proxy server
   *
   * @returns ProxyCore
   *
   * @memberOf ProxyCore
   */
  start() {
    
    const self = this;
    self.socketIndex = 0;
    self.socketPool = {};

    return new Promise((resolve, reject) => {
      if (self.status !== PROXY_STATUS_INIT) {
        throw new Error('server status is not PROXY_STATUS_INIT, can not run start()');
      }
      async.series(
        [
          //creat proxy server
          function (callback) {
            if (self.proxyType === T_TYPE_HTTPS) {
              certMgr.getCertificate(self.proxyHostName, (err, keyContent, crtContent) => {
                if (err) {
                  callback(err);
                } else {
                  self.httpProxyServer = https.createServer({
                    key: keyContent,
                    cert: crtContent
                  }, self.requestHandler.userRequestHandler);
                  callback(null);
                }
              });
            } else {
              self.httpProxyServer = http.createServer(self.requestHandler.userRequestHandler);
              callback(null);
            }
          },

          //handle CONNECT request for https over http
          function (callback) {
            self.httpProxyServer.on('connect', self.requestHandler.connectReqHandler);
            callback(null);
          },

          function (callback) {
            wsServerMgr.getWsServer({
              server: self.httpProxyServer,
              connHandler: self.requestHandler.wsHandler
            });
            // remember all sockets, so we can destory them when call the method 'close';
            self.httpProxyServer.on('connection', (socket) => {
              self.handleExistConnections.call(self, socket);
            });
            callback(null);
          },

          //start proxy server
          function (callback) {
            self.httpProxyServer.listen(self.proxyPort);
            callback(null);
          },
        ],

        //final callback
        (err, result) => {
          if (!err) {
            const tipText = (self.proxyType === T_TYPE_HTTP ? 'Http' : 'Https') + ' proxy started on port ' + self.proxyPort;
            logUtil.printLog(color.green(tipText));

            if (self.webServerInstance) {
              const webTip = 'web interface started on port ' + self.webServerInstance.webPort;
              logUtil.printLog(color.green(webTip));
            }

            let ruleSummaryString = '';
            const ruleSummary = this.proxyRule.summary;
            if (ruleSummary) {
              co(function *() {
                if (typeof ruleSummary === 'string') {
                  ruleSummaryString = ruleSummary;
                } else {
                  ruleSummaryString = yield ruleSummary();
                }

                logUtil.printLog(color.green(`Active rule is: ${ruleSummaryString}`));
              });
            }

            self.status = PROXY_STATUS_READY;
            self.emit('ready');
            resolve('READY');
          } else {
            const tipText = 'err when start proxy server :(';
            logUtil.printLog(color.red(tipText), logUtil.T_ERR);
            logUtil.printLog(err, logUtil.T_ERR);
            self.emit('error', {
              error: err
            });
            reject(err);
          }
        }
      );
    });
    // return self;
  }


  /**
   * close the proxy server
   *
   * @returns ProxyCore
   *
   * @memberOf ProxyCore
   */
  close() {
    // clear recorder cache
    return new Promise((resolve) => {
      if (this.httpProxyServer) {
        // destroy conns & cltSockets when closing proxy server
        for (const connItem of this.requestHandler.conns) {
          const key = connItem[0];
          const conn = connItem[1];
          logUtil.printLog(`destorying https connection : ${key}`);
          conn.end();
        }

        for (const cltSocketItem of this.requestHandler.cltSockets) {
          const key = cltSocketItem[0];
          const cltSocket = cltSocketItem[1];
          logUtil.printLog(`closing https cltSocket : ${key}`);
          cltSocket.end();
        }

        if (this.socketPool) {
          for (const key in this.socketPool) {
            this.socketPool[key].destroy();
          }
        }

        this.httpProxyServer.close((error) => {
          if (error) {
            console.error(error);
            logUtil.printLog(`proxy server close FAILED : ${error.message}`, logUtil.T_ERR);
          } else {
            this.httpProxyServer = null;

            this.status = PROXY_STATUS_CLOSED;
            logUtil.printLog(`proxy server closed at ${this.proxyHostName}:${this.proxyPort}`);
          }
          resolve(error);
        });
      } else {
        resolve();
      }
    })
  }
}

/**
 * start proxy server as well as recorder
 */
class ProxyServer extends ProxyCore {
  /**
   *
   * @param {object} config - config
   */
  constructor(config) {
    // prepare a recorder
    const recorder = new Recorder();
    const configForCore = Object.assign({
      recorder,
    }, config);

    super(configForCore);
    this.recorder = recorder;
    this.webServerInstance = null;
  }

  start() {
    return super.start();
  }

  close() {
    return new Promise((resolve, reject) => {
      super.close()
        .then((error) => {
          if (error) {
            resolve(error);
          }
        });

      if (this.recorder) {
        logUtil.printLog('clearing cache file...');
        this.recorder.clear();
      }
      const tmpWebServer = this.webServerInstance;
      this.recorder = null;
      this.webServerInstance = null;
      if (tmpWebServer) {
        logUtil.printLog('closing webserver...');
        tmpWebServer.close((error) => {
          if (error) {
            console.error(error);
            logUtil.printLog(`proxy web server close FAILED: ${error.message}`, logUtil.T_ERR);
          } else {
            logUtil.printLog(`proxy web server closed at ${this.proxyHostName} : ${this.webPort}`);
          }

          resolve(error);
        })
      } else {
        resolve(null);
      }
    });
  }
}


class EzProxyServer {
  constructor(port, networkSettings) {
    this.networkSettings = networkSettings || null;
    this._persistentNetworkAdaptorProxySession = null;

    this.host = '127.0.0.1'; // Host defaults to current system itself.
    this.port = port;
    
  
    this._recording = false;
    this.filterFunctions = {};
    this.filteredRecords = {};

    this.allRecords = {};

    this.checkRootCertificate();
    this.createProxyServer();

    this._updateRuleOnRequest();
    this._updateRuleOnResponse();
    this._updateForceHTTPSBeforeRequest();
    this._updateRuleOnError();
    this._updateRuleOnConnectError();
  }

  enablePersistentNetworkAdaptorProxySession(networkAdaptorName, binary) {
    var seconds = 1;
    this._persistentNetworkAdaptorProxySession = setInterval(function() {
      // console.log("Changing Network Adaptor Settings");
      if (!systemProxyMgr.enableNetworkAdaptorProxy(networkAdaptorName, binary)) {
        console.error("There was an error in configuring Network Adaptor Proxy for " + networkAdaptorName)
      }
    }, seconds * 1000);
  }

  disablePersistentNetworkAdaptorProxySession() {
    clearInterval(this._persistentNetworkAdaptorProxySession)
  }

  enableNetworkAdaptorProxySession(networkSettings) {
    var persistent = networkSettings.persistent || false;
    var networkAdaptorName = networkSettings.networkAdaptorName;
    if(networkAdaptorName){
        var binary = convert(this.host + ":" + this.port, {in: 'binary'}).toString('hex').toUpperCase().pad();
        if(persistent) {
          this.enablePersistentNetworkAdaptorProxySession(networkAdaptorName, binary)
        } else {
          if (!systemProxyMgr.enableNetworkAdaptorProxy(networkAdaptorName, binary)) {
            console.error("There was an error in configuring Network Adaptor Proxy for " + networkAdaptorName)
          }
        }
    } else {
      console.error("Network Adaptor Name was not provided! Skipping this configuration.");
    } 
  }

  getServerState() {
    return this.proxyServer.status;
  }

  createProxyServer() {
    this.proxyServer = new ProxyServer({
      port: this.port,
    });
  }

  enableForceProxyHttps() {
    this.proxyServer.requestHandler.forceProxyHttps = true;
  }

  disableForceProxyHttps() {
    this.proxyServer.requestHandler.forceProxyHttps = false;
  }

  _updateRuleOnRequest() {
    function* allRulesOnRequest(req, rules) {
      for (const ruleName in rules) {
        const ruleResult = rules[ruleName](req)
        if (ruleResult) {
          return ruleResult
        } 
      }
      return null;
    }
    this.proxyServer.requestHandler.userRule.beforeSendRequest = allRulesOnRequest;
  }

  addRuleOnRequest(ruleName, ruleFunction) {
    this.proxyServer.requestHandler.rulesOnRequest[ruleName] = ruleFunction;
  }

  removeRuleOnRequest(ruleName) {
    delete this.proxyServer.requestHandler.rulesOnRequest[ruleName];
  }

  _updateRuleOnResponse() {
    function *allRulesOnResponse(req, res, rules) {
      for (const ruleName in rules) {
        const ruleResult = rules[ruleName](req, res)
        if (ruleResult) {
          return ruleResult
        } 
      }
      return null;
    }
    this.proxyServer.requestHandler.userRule.beforeSendResponse = allRulesOnResponse;
  }

  addRuleOnResponse(ruleName, ruleFunction) {
    this.proxyServer.requestHandler.rulesOnResponse[ruleName] = ruleFunction;
  }

  removeRuleOnResponse(ruleName) {
    delete this.proxyServer.requestHandler.rulesOnResponse[ruleName];
  }

  _updateForceHTTPSBeforeRequest() {
    function *allRulesOnForceHTTPSBeforeRequest(req, rules, state) {
      for (const ruleName in rules) {
        const ruleResult = rules[ruleName](req)
        if (ruleResult) {
          return ruleResult
        } 
      }
      return state;
    }
    this.proxyServer.requestHandler.userRule.beforeDealHttpsRequest = allRulesOnForceHTTPSBeforeRequest;
  }

  addRuleOnForceHTTPSBeforeRequest(ruleName, ruleFunction) {
    this.proxyServer.requestHandler.rulesOnRuleForceHTTPSBeforeRequest[ruleName] = ruleFunction;
  }

  removeRuleForceHTTPSBeforeRequest(ruleName) {
    delete this.proxyServer.requestHandler.rulesOnRuleForceHTTPSBeforeRequest[ruleName];
  }

  _updateRuleOnError() {
    function *allRuleOnError(req, error, rules) {
      for (const ruleName in rules) {
        const ruleResult = rules[ruleName](req, error)
        if (ruleResult) {
          return ruleResult
        } 
      }
      return null;
    }
    this.proxyServer.requestHandler.userRule.onError = allRuleOnError;
  }

  addRuleOnError(ruleName, ruleFunction) {
    this.proxyServer.requestHandler.rulesOnError[ruleName] = ruleFunction;
  }

  removeRuleOnError(ruleName) {
    delete this.proxyServer.requestHandler.rulesOnError[ruleName];
  }

  _updateRuleOnConnectError() {
    function *allRulesOnConnectError(req, error, rules) {
      for (var ruleName in rules) {
        ruleResult = rules[ruleName](req, error)
        if (ruleResult) {
          return ruleResult
        } 
      }
      return null;
    }
    this.proxyServer.requestHandler.userRule.onConnectError = allRulesOnConnectError;
  }

  addRuleOnConnectError(ruleName, ruleFunction) {
    this.proxyServer.requestHandler.rulesOnConnectError[ruleName] = ruleFunction;
  }

  removeRuleOnConnectError(ruleName) {
    delete this.proxyServer.requestHandler.rulesOnConnectError[ruleName];
  }

  checkRootCertificate() {
    if (!certMgr.ifRootCAFileExists()) {
      certMgr.generateRootCA((error, keyPath) => {
        if (!error) {
          const certDir = require('path').dirname(keyPath);
          console.log('The cert is generated at', certDir);
          const isWin = /^win/.test(process.platform);
          if (isWin) {
            exec('start .', { cwd: certDir });
          } else {
            exec('open .', { cwd: certDir });
          }
        } else {
          console.error('error when generating rootCA', error);
        }
      });
    }
  }

  addFilter(filterName, filterFunction) {
    this.filterFunctions[filterName] = filterFunction
  }

  removeFilter(filterName) {
    delete this.filterFunctions[filterName];
  }

  removeAllFilters() {
    this.filterFunctions = {};
  }

  applyFiltersAndStoreResults(record) {
    for (var filterName in this.filterFunctions) {
      record = this.filterFunctions[filterName](record);
      if (record) {
        if(filterName in this.filteredRecords) {
          this.filteredRecords[filterName][record.id] = record;
        } else {
          this.filteredRecords[filterName] = {};
          this.filteredRecords[filterName][record.id] = record;
        }
      }
    }
  }

  startRecording() {
    const self = this;
    this._recording = true;
    this.proxyServer.recorder.records = onChange(this.proxyServer.recorder.records, function (path, record, previousValue) {
      if (self._recording) {
        self.applyFiltersAndStoreResults(record);
        self.allRecords[record.id] = record;
      }
    });
  }

  stopRecording() {
    this._recording = false;
    onChange.unsubscribe(this.proxyServer.recorder.records);
  }

  startAndRecord() {
    if (!systemProxyMgr.getProxyState()) {
      console.log("Enabling Proxy Settings...")
      systemProxyMgr.enableGlobalProxy(this.host, this.port);
    }
    if (systemProxyMgr.getProxyState()) {
      if(this.networkSettings) {
        this.enableNetworkAdaptorProxySession(this.networkSettings);
      }
      console.log("Starting Proxy Server...")
      this.proxyServer.start().then( state => {
        console.log("Proxy Server is " + state)
        this.startRecording();
      }).catch( error => {
        console.log("Proxy Server/Recorder was unable to start. Reason : " + error)
      });
    }
  }
  
  start() {
    if (!systemProxyMgr.getProxyState()) {
      console.log("Enabling Proxy Settings...")
      systemProxyMgr.enableGlobalProxy(this.host, this.port);
    }
    if (systemProxyMgr.getProxyState()) {
      if(this.networkSettings) {
        this.enableNetworkAdaptorProxySession(this.networkSettings);
      }
      console.log("Starting Proxy Server...")
      return this.proxyServer.start();
    }
  }

  stop() {
    console.log("Stopping Proxy Server...")
    this.proxyServer.close().then( e => {
      systemProxyMgr.disableGlobalProxy();
      this._recording = false;
    });
  }

  // * getResults(filterName, intervalSeconds) {
  //     setInterval(function() {
  //       yield this.results[filterName]
  //   }, interval * 1000);
  // }
}

module.exports.ProxyServer = EzProxyServer;

