
//- Modified work Copyright 2019 Abhimanyu Pandian

//- Licensed under the Apache License, Version 2.0 (the "License");
//- you may not use this file except in compliance with the License.
//- You may obtain a copy of the License at

//-     http://www.apache.org/licenses/LICENSE-2.0

//- Unless required by applicable law or agreed to in writing, software
//- distributed under the License is distributed on an "AS IS" BASIS,
//- WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//- See the License for the specific language governing permissions and
//- limitations under the License.

'use strict';

// const log = require('why-is-node-running')

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
  fs = require('fs'),
  utils = require('util'),
  convert = require('binstring');

// var log_file = fs.createWriteStream('/debug.log', { flags: 'w' });
// var log_stdout = process.stdout;

// logUtil.printLog = function (d) {
//    log_file.write(utils.format(d) + '\n');
//    log_stdout.write(utils.format(d) + '\n');
// };

// const memwatch = require('memwatch-next');

// setInterval(() => {
//   logUtil.printLog(process.memoryUsage());
//   const rss = Math.ceil(process.memoryUsage().rss / 1000 / 1000);
//   logUtil.printLog('Program is using ' + rss + ' mb of Heap.');
// }, 1000);

// memwatch.on('stats', (info) => {
//   logUtil.printLog('gc !!');
//   logUtil.printLog(process.memoryUsage());
//   const rss = Math.ceil(process.memoryUsage().rss / 1000 / 1000);
//   logUtil.printLog('GC !! Program is using ' + rss + ' mb of Heap.');

//   // var heapUsed = Math.ceil(process.memoryUsage().heapUsed / 1000);
//   // logUtil.printLog("Program is using " + heapUsed + " kb of Heap.");
//   // logUtil.printLog(info);
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

  throttle(bps) {
    const rate = parseInt(bps, 10);
    if (rate < 1) {
      throw new Error('Invalid throttle rate value, should be positive integer');
    }
    global._throttle = new ThrottleGroup({ rate: 1024 * rate }); // rate - byte/sec    }
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
    return new Promise((resolve, reject) => {
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
            logUtil.printLog(`proxy server close FAILED : ${error.message}`, logUtil.T_ERR);
          } else {
            this.httpProxyServer = null;
            this.status = PROXY_STATUS_CLOSED;
            logUtil.printLog(`proxy server closed at ${this.proxyHostName}:${this.proxyPort}`);
            resolve("CLOSED");
          }
          reject(error);
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
class _ProxyServer extends ProxyCore {
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
      super.close().then((done) => {
          if (this.recorder) {
            logUtil.printLog('clearing cache file...');
            this.recorder.clear();
            resolve("CLOSED");
          }
        }).catch(error => {
          logUtil.printLog('Unable to clready cache file. Reason : ' + error);
          reject(error);
        })
    });
  }
}


class ProxyServer {
  
  constructor(port, networkSettings) {
    this.networkSettings = networkSettings || null;
    this._persistentNetworkAdaptorProxySession = null;

    this.host = '127.0.0.1'; // Host defaults to current system itself.
    this.port = port;
  
    // this.tests = {};

    this.checkRootCertificate();
    this.createProxyServer();

    this._updateRuleOnRequest();
    this._updateRuleOnResponse();
    this._updateForceHTTPSBeforeRequest();
    this._updateRuleOnError();
    this._updateRuleOnConnectError();
  }

  throttle(bps) {
    this.proxyServer.throttle(bps);
  }

  createProxyServer() {
    this.proxyServer = new _ProxyServer({
      port: this.port,
    });
  }

  enablePersistentNetworkAdaptorProxySession(networkAdaptorName, binary) {
    var seconds = 1;
    this._persistentNetworkAdaptorProxySession = setInterval(function() {
      // logUtil.printLog("Changing Network Adaptor Settings");
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
          logUtil.printLog('The cert is generated at', certDir);
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
    this.proxyServer.recorder.filterFunctions[filterName] = filterFunction
  }

  removeFilter(filterName) {
    delete this.proxyServer.recorder.filterFunctions[filterName];
  }

  removeAllFilters() {
    this.proxyServer.recorder.filterFunctions = {};
  }

  addTests(testDefinitions) {
    testDefinitions = testDefinitions || {};
    if (Object.keys(testDefinitions).length == 0) {
      logUtil.printLog("[TEST ERROR] No Test Defintions found. Tests wont be added.")
    } else {
      var tests = this.proxyServer.recorder.tests;
      for (var eachTestName in testDefinitions) {
        var eachTest = testDefinitions[eachTestName]
        // logUtil.printLog(eachTest)
        if (!eachTest.test) {
          logUtil.printLog("[TEST INFO] Test function not provided for test " + eachTest.testName + ". Skipping the test!")
        } if (!eachTest.isMandatoryAlways) {
          logUtil.printLog("[TEST INFO] isMandatoryAlways parameter not provided for test " + eachTest.testName + ". Defaulting to 'true'.")
        }
        tests[eachTestName] = eachTest
        if (!tests[eachTestName]['testCount']) {
          tests[eachTestName]['testCount'] = 1;
        }
        tests[eachTestName]['testedCount'] = 0;
        tests[eachTestName]['enabled'] = true;

        // For checking if all tests are complete and stop the test.
        tests[eachTestName]['completedTests'] = [];
      }
    }
  }

  enableTest(testName) {
    this.proxyServer.recorder.tests[testName]['enabled'] = true;
  }

  enableAllTests() {
    for (var eachTest in this.proxyServer.recorder.tests) {
      this.proxyServer.recorder.tests[eachTest]['enabled'] = true;
    }
  }

  disableTest(testName) {
    this.proxyServer.recorder.tests[testName]['enabled'] = false;
  }

  disableAllTests() {
    for (var eachTest in this.proxyServer.recorder.tests) {
      this.proxyServer.recorder.tests[eachTest]['enabled'] = false;
    }
  }

  enableEndTestAfterComplete() {
    this._endAfterTestsComplete = true;
  }

  disableEndTestAfterComplete() {
    this._endAfterTestsComplete = false;
  }

  _startCheckForTestsCompletion() {
    if (this._endAfterTestsComplete) {
      const self = this;
      var seconds = 1;
      setInterval(function() {
        if(Object.keys(self.proxyServer.recorder.tests).length == 0) {
          logUtil.printLog("All Tests completed! Generating HTML report...")
          self.stop();
        }
      }, seconds * 1000);
    }
  }

  start(options) {
    const self = this;
    this.stopping = false;

    options = options || {};

    this._enableTests = options.enableTests;
    this._endAfterTestsComplete = options.endAfterTestsComplete;

    const duration = options.duration;
    if (duration) {
      logUtil.printLog("[SERVER INFO] Proxy Server will run for " + duration + " minutes(s).")
      setTimeout(function() {
        logUtil.printLog("[SERVER INFO] Proxy Server ran for " + duration + " minute(s). Stopping...")
        self.stop();
      }, duration * 60 * 1000);
    }

    if (this.proxyServer.recorder.filterFunctions == {}) {
      logUtil.printLog("[SERVER INFO] No Filters are added for this session.")
    }
    
    if (this.proxyServer.recorder.tests == {}) {
      logUtil.printLog("[SERVER INFO] No Tests are added for this session.")
    } else {
      this._startCheckForTestsCompletion();
    }

    if (!systemProxyMgr.getProxyState()) {
      logUtil.printLog("[SERVER INFO] Enabling Proxy Settings...")
      systemProxyMgr.enableGlobalProxy(this.host, this.port);
    }
    if (systemProxyMgr.getProxyState()) {
      if(this.networkSettings) {
        this.enableNetworkAdaptorProxySession(this.networkSettings);
      }
      logUtil.printLog("[SERVER INFO] Starting Proxy Server...")
        self.proxyServer.start().then( state => {
          logUtil.printLog("[SERVER INFO] Proxy Server is " + state)
        }).catch( error => {
          logUtil.printLog("[SERVER INFO] Proxy Server was unable to start. Reason : " + error)
        });
    }
  }

  finalizeTests() {
    if(this._enableTests) {
      // console.log(JSON.stringify(this.suite.data))
      this.proxyServer.recorder.mocha.run(function () {
        logUtil.printLog("[SERVER INFO] Tests completed!");
        // log() // logs out active handles that are keeping node running
        process.exit();
      }) 
    } else {
      process.exit();
    }

  }

  stop() {
    if(!this.stopping) {
      this.stopping = true;
      this.proxyServer.close().then( closed => {
        systemProxyMgr.disableGlobalProxy();
        logUtil.printLog("[SERVER INFO] Proxy Server was stopped...");
        this.finalizeTests();
   
      }).catch( error => {
        logUtil.printLog("[SERVER LOG] There was an error while stopping Proxy Server. Reason : " + error)
        this.finalizeTests();
      })
    }
  }
}

module.exports.ProxyServer = ProxyServer;
