
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

proxy = require('ezproxy');

server = new proxy.ProxyServer(
    '8888', 
    // {
    //     persistent: true,
    //     networkAdaptorName: "VPN Adapter",
    // }
)

function before(req) {
    if (req.host.toString().includes('.com')) {
        const newReqMethod = req._req;
        newReqMethod.method = 'GETTO';
        const newRequestOptions = req.requestOptions;
        return {
          requestOptions: newRequestOptions,
          _req: newReqMethod
        };
    }
}

function beforeResponse(req, res) {
    // console.log(req)
    var newResponse = Object.assign({}, res.response);
    newResponse.statusCode = 207;
    return {
      response: newResponse
    };
}

function beforeResponse1(req, res) {
    // console.log(res)
    var newResponse = Object.assign({}, res.response);
    newResponse.statusCode = newResponse.statusCode + 1;
    return {
      response: newResponse
    };
}

function vpnFilter(record) {
    // console.log(record)
    if (record.statusCode.toString().includes('12345')) {
        return record
    }
}

server.enableForceProxyHttps()
// server.addRuleOnHTTPSRequest('rule_for_vpn_before', before)
// server.addRuleOnResponse('rule_for_response_before', beforeResponse)
// server.addRuleOnResponse('rule_for_response_before1', beforeResponse1)
// server.addFilter('vpn_filter', vpnFilter)

server.addTests({
    "TESTCASE 1": {
        "if": "record.statusCode != ''",
        "validate": "record.statusCode == 200",
    },
    "VALIDATION 1": {
        "if": "record.host.includes('com')",
        "validate": "record.statusCode == 200",
    }
})

server.start({
    enableTests: true,  
    duration: 0.2
})


// Mocha = require('mocha');
// const addContext = require('mochawesome/addContext');
 
// describe('test suite', function () {
//     console.log(this)
//   it('should add context', function () {
//       console.log(this)
//     // context can be a simple string
//     addContext(this, 'simple string');
 
//     // context can be a url and the report will create a link
//     addContext(this, 'http://www.url.com/pathname');
 
//     // context can be an image url and the report will show it inline
//     addContext(this, 'http://www.url.com/screenshot-maybe.jpg');
 
//     // context can be an object with title and value properties
//     addContext(this, {
//       title: 'expected output',
//       value: {
//         a: 1,
//         b: '2',
//         c: 'd'
//       }
//     });
//   })
// });

// server.removeRuleOnResponse('rule_for_response_before')

// Start printing results every 5 seconds
// printLogs = setInterval(function() {
//     console.log(server.tests)
// }, 5 * 1000);

