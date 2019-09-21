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

'use strict'

//start recording and share a list when required
const Datastore = require('nedb'),
  path = require('path'),
  fs = require('fs'),
  uuid = require('uuid'),
  logUtil = require('./log'),
  events = require('events'),
  iconv = require('iconv-lite'),
  fastJson = require('fast-json-stringify'),
  Mocha = require('mocha'),
  proxyUtil = require('./util');

const wsMessageStingify = fastJson({
  title: 'ws message stringify',
  type: 'object',
  properties: {
    time: {
      type: 'integer'
    },
    message: {
      type: 'string'
    },
    isToServer: {
      type: 'boolean'
    }
  }
});

const BODY_FILE_PRFIX = 'res_body_';
const WS_MESSAGE_FILE_PRFIX = 'ws_message_';
const CACHE_DIR_PREFIX = 'cache_r';
function getCacheDir() {
  const rand = Math.floor(Math.random() * 1000000),
    cachePath = path.join(proxyUtil.getEzProxyPath('cache'), './' + CACHE_DIR_PREFIX + rand);

  fs.mkdirSync(cachePath);
  return cachePath;
}

function normalizeInfo(id, info) {
  const singleRecord = {};
  //general
  singleRecord._id = id;
  singleRecord.id = id;
  singleRecord.url = info.url;
  singleRecord.host = info.host;
  singleRecord.path = info.path;
  singleRecord.method = info.method;

  //req
  singleRecord.reqHeader = JSON.stringify(info.req.headers);
  singleRecord.startTime = info.startTime;
  singleRecord.reqBody = info.reqBody || '';
  singleRecord.protocol = info.protocol || '';
  singleRecord.reqBody = singleRecord.reqBody.toString();
  //res
  if (info.endTime) {
    singleRecord.statusCode = info.statusCode;
    singleRecord.endTime = info.endTime;
    singleRecord.resHeader = JSON.stringify(info.resHeader);
    singleRecord.resBody = info.resBody.toString();
    singleRecord.length = info.length;
    const contentType = info.resHeader['content-type'] || info.resHeader['Content-Type'];
    if (contentType) {
      singleRecord.mime = contentType.split(';')[0];
    } else {
      singleRecord.mime = '';
    }

    singleRecord.duration = info.endTime - info.startTime;
  } else {
    singleRecord.statusCode = '';
    singleRecord.endTime = '';
    singleRecord.resHeader = '';
    singleRecord.length = '';
    singleRecord.mime = '';
    singleRecord.duration = '';
  } 

  return singleRecord;
}

class Recorder extends events.EventEmitter {
  constructor(config) {
    super(config);
    this.globalId = 1;
    this.cachePath = getCacheDir();
    logUtil.printLog("Records Location : " + this.cachePath + 'data')
    this.db = new Datastore({ filename: this.cachePath + '_data' });
    this.db.persistence.setAutocompactionInterval(5001);
    this.recordBodyMap = [];  // id - body

    this.filterFunctions = null;

    this.initializeMocha();
  }
    
  initializeMocha() {
    this.startTime = new Date();

    const testID = this.startTime.toString().split(" ").slice(0,3);
    this.reportName = 'html_report_' + testID.join("_") + "_" + uuid.v1();
    const suite = new Mocha.Suite("EZProxy Test Results [" + testID.join(" ") + "]");
    suite['startTime'] = this.startTime;
    this.mocha = new Mocha({
      ui: 'bdd',
      quiet: true,
      reporter: 'mochawesome',
      reporterOptions: {
        reportFilename: this.reportName,
        json: false,
      }
    });
    logUtil.printLog("HTML report name : " + this.reportName)
    
    this.rootUUID = uuid.v4();
    suite.data = {"uuid":this.rootUUID,"title":"EZProxy Test Results [" + this.startTime.toString() + "]","fullFile":"","file":"","beforeHooks":[],"afterHooks":[],
                                "tests":[],"suites":[],"passes":[],"failures":[],"pending":[],"skipped":[],"duration":0,"root":false,"rootEmpty":false,"_timeout":2000}

    this.mocha.suite = suite;

    this.tests = {};
  };

  emitUpdate(id, info) {
    const self = this;
    if (info) {
      self.emit('update', info);
    } else {
      self.getSingleRecord(id, (err, doc) => {
        if (!err && !!doc && !!doc[0]) {
          self.emit('update', doc[0]);
        }
      });
    }
  }

  performTestsOnRecord(record) {
    const self = this;
    const testSuiteUUID = uuid.v4();
    self.testSuite = {"parentUUID": self.rootUUID, "uuid":testSuiteUUID,"title":"[" + new Date(record.startTime).toString().split(" ").slice(4,5).join(":") + "] CONNECT " + 
                  record.host,"fullFile":"","file":"","beforeHooks":[],"afterHooks":[],"tests":[],"suites":[],"passes":[],"failures":[],"pending":[],"skipped":[],
                                      "duration":1,"root":false,"rootEmpty":false,"_timeout":2000};
    
    Object.keys(self.tests).forEach(function(eachTestName) {
            const eachTest = self.tests[eachTestName];
            const testEnabled = eachTest.enabled;
            // console.log(eachTest.if + "-" + record.host + " - " + (eachTest['testedCount'] < eachTest['testCount']))
            const testedCount = eachTest['testedCount'];
            const testCount = eachTest['testCount'];
            if (testedCount < testCount) {
              if (testEnabled) {
                try {
                  const shouldPassAlways = eachTest.shouldPassAlways;
                  const testResult =  eachTest.test(record);
                    
                  const testUUID = uuid.v4();
                  const data = JSON.stringify({title: "Data ", value: record})

                  var test = {"parentUUID": testSuiteUUID, "title":eachTestName, "fullTitle":"",
                            "timedOut":false,"duration":0,"state":"passed","speed":"fast",
                            "pass":false,"fail":false,"pending":false,"context": data,
                            "code":"","err":{},"uuid":testUUID,"parentUUID":testSuiteUUID,"isHook":false,
                            "skipped":false}

                  self.mocha.suite.data.tests.push(testUUID)

                  if (shouldPassAlways) {
                    // TODO: If the test fails once, do not execute the test again. Helps utilize lesser memory.
                  }

                  if (testResult) {
                    test.state = "passed";
                    test.pass = true;
                    self.testSuite.passes.push(testUUID)
                    self.mocha.suite.data.passes.push(testUUID)
                  } else {
                    test.state = "failed";
                    test.fail = true;
                    self.testSuite.failures.push(testUUID)
                    self.mocha.suite.data.failures.push(testUUID)
                  }

                  self.testSuite.tests.push(test);
                  self.tests[eachTestName]['testedCount'] += 1;

                } catch (e) {
                  logUtil.printLog("[TEST ERROR] There was a failure while executing test " + eachTestName + " because : " + e.toString())
                  test.code = e.toString();
                  test.state = "failed";
                  test.fail = true;
                  self.testSuite.failures.push(testUUID)
                  self.mocha.suite.data.failures.push(testUUID)
                  self.tests[eachTestName]['testedCount'] += 1;
                }
                var now  = new Date();
                test.duration = Math.abs(now.getTime() - self.startTime.getTime())
            } 
          } else if (testedCount == testCount) {
            delete self.tests[eachTestName];
            logUtil.printLog(eachTestName + " was completed!")
          } 
        }
      );
      // TODO: This is to include skipped tests also. But utilizes a lot fo memory.
      // if (self.testSuite.tests.length == 0) {
      //   const testUUID = uuid.v4();
      //   const data = JSON.stringify({title: "Data : ", value: record})
      //   var test = {"parentUUID": testSuiteUUID, "title": "No tests were run for this record because no test conditions were satisifed or tests count exceeded.","fullTitle":"","timedOut":false,"duration":0,"state":"passed","speed":"fast","pass":false,"fail":false,"pending":false,"context": data,"code":"","err":{},"uuid":testUUID,"parentUUID":testSuiteUUID,"isHook":false,"skipped":true}
      //   self.testSuite.tests.push(test);
      //   self.testSuite.skipped.push(testUUID);
      //   self.suite.data.skipped.push(testUUID)
      // }
      
      if (self.testSuite.tests.length != 0) {
        self.mocha.suite.data.suites.push(self.testSuite);
      }
      // console.log(JSON.stringify(self.mocha.suite.data.suites))
      var now  = new Date();
      self.testSuite.duration = Math.abs(now.getTime() - self.startTime.getTime())
  }

  emitUpdateLatestWsMessage(id, message) {
    this.emit('updateLatestWsMsg', message);
  }

  updateRecord(id, info) {
    if (id < 0) return;
    const self = this;
    const db = self.db;

    const finalInfo = normalizeInfo(id, info);
    const testsAvailable = Object.keys(self.tests).length;
    if (this.filterFunctions) {
      for (var filterName in this.filterFunctions) {
        if (this.filterFunctions[filterName](finalInfo)) {
          db.update({ _id: id }, finalInfo);
          this.updateRecordBody(id, info);
          this.emitUpdate(id, finalInfo);
          if (testsAvailable) {
            self.performTestsOnRecord(finalInfo);
            };
          }
        }
    } else {
      db.update({ _id: id }, finalInfo);
      this.updateRecordBody(id, info);
      this.emitUpdate(id, finalInfo);
      if (testsAvailable) {
        self.performTestsOnRecord(finalInfo);
      };
    }
    
    // db.update({ _id: id }, finalInfo, {returnUpdatedDocs:true}, function (err, num, affectedDocuments, upsert) {
    //   console.log(self.records)
    //   self.records[id] = affectedDocuments;
    // });

    // this.records[id] = finalInfo;
    // this.updateRecordBody(id, info);
    // this.emitUpdate(id, finalInfo);
  }

  /**
  * This method shall be called at each time there are new message
  *
  */
  updateRecordWsMessage(id, message) {
    if (id < 0) return;
    try {
      this.getCacheFile(WS_MESSAGE_FILE_PRFIX + id, (err, recordWsMessageFile) => {
        if (err) return;
        fs.appendFile(recordWsMessageFile, wsMessageStingify(message) + ',', () => {});
      });
    } catch (e) {
      console.error(e);
      logUtil.error(e.message + e.stack);
    }

    this.emitUpdateLatestWsMessage(id, {
      id: id,
      message: message
    });
  }

  updateExtInfo(id, extInfo) {
    const self = this;
    const db = self.db;

    db.update({ _id: id }, { $set: { ext: extInfo } }, {}, (err, nums) => {
      if (!err) {
        self.emitUpdate(id);
      }
    });
  }

  appendRecord(info) {
    const self = this;
    const db = self.db;

    const thisId = self.globalId++;
    const finalInfo = normalizeInfo(thisId, info);
    const testsAvailable = Object.keys(self.tests).length;

    if (this.filterFunctions) {
      for (var filterName in this.filterFunctions) {
        if (this.filterFunctions[filterName](finalInfo)) {
          db.insert(finalInfo);
          self.updateRecordBody(thisId, info);
          self.emitUpdate(thisId, finalInfo);
          if (testsAvailable) {
            self.performTestsOnRecord(finalInfo);
            };
        }
      }
    } else {
      db.insert(finalInfo);
      self.updateRecordBody(thisId, info);
      self.emitUpdate(thisId, finalInfo);
      if (testsAvailable) {
        self.performTestsOnRecord(finalInfo);
      };
    }
    return thisId;
  }

  updateRecordBody(id, info) {
    const self = this;

    if (id === -1) return;

    if (!id || typeof info.resBody === 'undefined') return;
    //add to body map
    //ignore image data
    self.getCacheFile(BODY_FILE_PRFIX + id, (err, bodyFile) => {
      if (err) return;
      fs.writeFile(bodyFile, info.resBody, () => {});
    });
  }

  /**
  * get body and websocket file
  *
  */
  getBody(id, cb) {
    const self = this;

    if (id < 0) {
      cb && cb('');
      return;
    }
    self.getCacheFile(BODY_FILE_PRFIX + id, (error, bodyFile) => {
      if (error) {
        cb && cb(error);
        return;
      }
      fs.access(bodyFile, fs.F_OK || fs.R_OK, (err) => {
        if (err) {
          cb && cb(err);
        } else {
          fs.readFile(bodyFile, cb);
        }
      });
    });
  }

  getDecodedBody(id, cb) {
    const self = this;
    const result = {
      method: '',
      type: 'unknown',
      mime: '',
      content: ''
    };
    self.getSingleRecord(id, (err, doc) => {
      //check whether this record exists
      if (!doc || !doc[0]) {
        cb(new Error('failed to find record for this id'));
        return;
      }

      // also put the `method` back, so the client can decide whether to load ws messages
      result.method = doc[0].method;

      self.getBody(id, (error, bodyContent) => {
        if (error) {
          cb(error);
        } else if (!bodyContent) {
          cb(null, result);
        } else {
          const record = doc[0],
            resHeader = record.resHeader || {};
          try {
            const headerStr = JSON.stringify(resHeader),
              charsetMatch = headerStr.match(/charset='?([a-zA-Z0-9-]+)'?/),
              contentType = resHeader && (resHeader['content-type'] || resHeader['Content-Type']);
              record.resHeader = headerStr
              if (charsetMatch && charsetMatch.length) {
              const currentCharset = charsetMatch[1].toLowerCase();
              if (currentCharset !== 'utf-8' && iconv.encodingExists(currentCharset)) {
                bodyContent = iconv.decode(bodyContent, currentCharset);
              }

              result.content = bodyContent.toString();
              result.type = contentType && /application\/json/i.test(contentType) ? 'json' : 'text';
            } else if (contentType && /image/i.test(contentType)) {
              result.type = 'image';
              result.content = bodyContent;
            } else {
              result.type = contentType;
              result.content = bodyContent.toString();
            }
            result.mime = contentType;
            result.fileName = path.basename(record.path);
            result.statusCode = record.statusCode;
          } catch (e) {
            console.error(e);
          }
          cb(null, result);
        }
      });
    });
  }

  /**
  * get decoded WebSoket messages
  *
  */
  getDecodedWsMessage(id, cb) {
    if (id < 0) {
      cb && cb([]);
      return;
    }

    this.getCacheFile(WS_MESSAGE_FILE_PRFIX + id, (outError, wsMessageFile) => {
      if (outError) {
        cb && cb(outError);
        return;
      }
      fs.access(wsMessageFile, fs.F_OK || fs.R_OK, (err) => {
        if (err) {
          cb && cb(err);
        } else {
          fs.readFile(wsMessageFile, 'utf8', (error, content) => {
            if (error) {
              cb && cb(err);
            }

            try {
              // remove the last dash "," if it has, since it's redundant
              // and also add brackets to make it a complete JSON structure
              content = `[${content.replace(/,$/, '')}]`;
              const messages = JSON.parse(content);
              cb(null, messages);
            } catch (e) {
              console.error(e);
              logUtil.error(e.message + e.stack);
              cb(e);
            }
          });
        }
      });
    });
  }

  getSingleRecord(id, cb) {
    const self = this;
    const db = self.db;
    db.find({ _id: parseInt(id, 10) }, cb);
  }

  getSummaryList(cb) {
    const self = this;
    const db = self.db;
    db.find({}, cb);
  }

  getRecords(idStart, limit, cb) {
    const self = this;
    const db = self.db;
    limit = limit || 10;
    idStart = typeof idStart === 'number' ? idStart : (self.globalId - limit);
    db.find({ _id: { $gte: parseInt(idStart, 10) } })
      .sort({ _id: 1 })
      .limit(limit)
      .exec(cb);
  }

  clear() {
    const self = this;
    proxyUtil.deleteFolderContentsRecursive(self.cachePath, true);
  }

  getCacheFile(fileName, cb) {
    const self = this;
    const cachePath = self.cachePath;
    const filepath = path.join(cachePath, fileName);

    if (filepath.indexOf(cachePath) !== 0) {
      cb && cb(new Error('invalid cache file path'));
    } else {
      cb && cb(null, filepath);
      return filepath;
    }
  }
}

module.exports = Recorder;
