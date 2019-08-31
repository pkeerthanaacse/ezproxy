
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
server.addFilter('vpn_filter', vpnFilter)
server.startAndRecord()
// server.removeRuleOnResponse('rule_for_response_before')

// Start printing results every 5 seconds
// printLogs = setInterval(function() {
    // console.log(server.filteredRecords['vpn_filter'])
// }, 5 * 1000);
