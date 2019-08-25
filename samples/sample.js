proxy = require('easy-proxy');

server = new proxy.ProxyServer(
    '8888', 
    // {
    //     persistent: true,
    //     networkAdaptorName: "Comcast VPN Adapter",
    // }
)

function before(req) {
    if (req.host.toString().includes('.com')) {
        const newReqMethod = req._req;
        newReqMethod.method = 'GETTTTTT';
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
