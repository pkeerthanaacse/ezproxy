Easy Proxy
----------------
A Proxy Server implementation in JS based on AnyProxy - https://github.com/alibaba/anyproxy - with additional functionalities including VPN support (Windows only) and end-to-end scripting support.


Installation
------------
```
npm install https://github.com/abhimanyupandian/ez-proxy
```

Declaration
------------
    
    const EzProxy = require('ez-proxy');

Creating Proxy Server Instance
------------

    // EzProxy.ProxyServer(<port>)
    // EzProxy runs on 127.0.0.1 by default. Port can be configured.
    proxy = new EzProxy.ProxyServer(8002)
    
Creating Proxy Server Instance to Support VPN (Windows only)
------------
    // In Windows - networkAdaptorName can be retrieved using cmd command "reg query 'HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings\Connections'"
    proxy = new EzProxy.ProxyServer(
        8888, {
        persistent: true,
        networkAdaptorName: "<VPN_ADAPTOR_NAME>",
    })

Creating Proxy Server Instance with Tests (Tested only on Windows)
------------
    server.start({
        enableTests: true, // Enable Tests
        endAfterTestsComplete: true, // End proxy session after tests are complete. Defaults to false.
        duration: 0.5 // The number of minutes the proxy session has to run. (0.5 minutes = 30 seconds)
    })

Rules
------------

   - [x] Rules are functions and must be defined as function <rule_name> (req, res).
   - [x] 'req' parameter can be used to modify request.
   - [x] 'res' parameter can be used to modify response.
   - [x] Rule functions must return requests or response objects - see API reference for examples.
   - [x] Rules can be added using addRuleOn<*>(<ruleName>, <ruleFunction>)
   - [x] Rules can be removeed using removeRuleOn<*>(<ruleName>)
   
Filters
------------

   - [x] Filters are functions and must be defined as function <filter_name> (record).
   - [x] 'record' parameter can be used to define conditions over requests/responses for filtering.
   - [x] Every filter function must return either the record (if the record must be collected) or null (if the response must be rejected).

Tests
------------

   - [x] Filters are functions and must be defined as function <test_name> (record).
   - [x] 'record' parameter can be used to write tests on requests/responses.
   - [x] Every filter function must return either true or false based on the test.
   
API Reference
------------

- start() : Starts the Proxy Server without storing results.

        proxy.start()

- startAndRecord() : Starts the Proxy Server and stores results into allRecords and filteredRecords (if any filter is available).

        proxy.startAndRecord()

- stop() : 

        proxy.stop()

- throttle(bps) : Sets the throttle rate in bps.

        proxy.throttle(512)

- getServerState() : Returns the current state (INIT/READY/CLOSED) of the Proxy Server created.
 
        proxy.getServerState()

- enableForceProxyHttps() : Forces HTTPS on all requests.
 
        proxy.enableForceProxyHttps()

- disableForceProxyHttps() : Disables forcing HTTPS on all requests.
 
        proxy.disableForceProxyHttps()

- addRuleOnRequest(req, res) : Adds a rule before sending request to target server.

        function simpleRuleBeforeRequest(req, res) {
              if (req.url.includes('api.test.net')) {
                const newReqMethod = req._req;
                newReqMethod.method = 'GET';
                const newRequestOptions = req.requestOptions;
                return {
                  requestOptions: newRequestOptions,
                  _req: newReqMethod
                };
            }
        }

        proxy.addRuleOnRequest('rule1', simpleRuleBeforeRequest)
        
- removeRuleOnRequest(filterName) : Removes existing rule on request.
 
        proxy.removeRuleOnRequest('rule1')
        
- addRuleOnResponse(req, res) : Adds a rule before sending response to client.

        function simpleRuleBeforeResponse(req, res) {
            if (req.url.toString().includes('give.me.response')) {
                const newResponse = res.response;
                newResponse.body += '- Proxy Edited!';
                return { response: newResponse };
            }
        }

        proxy.addRuleOnResponse('rule2', simpleRuleBeforeResponse)
        
- removeRuleOnResponse(filterName) : Removes existing rule on response.
 
        proxy.removeRuleOnResponse('rule2')
        
- addRuleOnForceHTTPSBeforeRequest(req, res) : Adds a rule to force HTTPS or not before sending request to target server.

        function simpleRuleBeforeHTTP(req, res) {
            if (req.url.toString().includes('give.me.response')) {
                return true;
            }
        }

        proxy.addRuleOnForceHTTPSBeforeRequest('rule3', simpleRuleBeforeHTTP)
        
- removeRuleOnForceHTTPSBeforeRequest(filterName) : Removes existing rule on forcing HTTPS.
 
        proxy.removeRuleOnForceHTTPSBeforeRequest('rule3')
        
- addRuleOnError(req, res) : Adds a rule on error.

        function simpleRuleOnError(req, res) {
           if (req.url.toString().includes('give.me.response')) {
                const newResponse = res.response;
                newResponse.body += '- Proxy Edited!';
                return { response: newResponse };
           }
         }

         proxy.addRuleOnError('rule4', simpleRuleOnError)
         
- removeRuleOnError(filterName) : Removes existing rule on error.
 
        proxy.removeRuleOnError('rule4')

- addRuleOnConnectError(req, res) : Adds a rule on Connection error.

        function simpleRuleOnConnectError(req, res) {
            if (req.url.toString().includes('give.me.response')) {
                const newResponse = res.response;
                newResponse.body += '- Proxy Edited!';
                return { response: newResponse };
            }
         }
         
        proxy.addRuleOnConnectError('rule5', simpleRuleOnConnectError)

- removeRuleOnConnectError(filterName) : Removes existing rule on Connection error.
 
        proxy.removeRuleOnConnectError('rule5')

- addFilter(filterName, filterFunction) : Adds a filter for the records(request + response) to be stored. Filtered records are stored in filteredRecords("<filter_name>")

        function simpleFilter(res) {
             if (res.url.toString().includes('api.test.net')) {
                 if(res.statusCode == 200) {
                   if (res.url.toString().endsWith(".pdf")){
                        return response;
                   }
                }
             }
         return null;
        }

        proxy.addFilter('filter-only-pdf-responses', simpleFilter)

- removeFilter(filterName) : Removes existing filter.
 
        proxy.removeFilter(filterName)

- removeAllFilters() : Removes all existing filters.
 
        proxy.removeAllFilters()
  
- addTests({}) : Adds tests.

        function alerts_test1(record) {
            if (record.host.includes('youtube.com')) {
                if (record.statusCode == 225) 
                {return true;}
            } return false;
        }

        function alerts_test2(record) {
            if (record.host.includes('ytimga.com')) {
                if (record.statusCode == 225) 
                {return true;}
            } return false;
        }
        
        proxy.addTests({"TC1" : {
                "test": alerts_test1,
                "testCount": 100, //This is the number of times the testcase has to be executed. Defaults to 1 if not provided.
                },
            "TC2" : {
                "test": alerts_test2
                }   
            })
            
- enableAllTests() : Enables all tests previously added using addTests.
        
        proxy.enableAllTests()
        
- disableAllTests() : Disables all tests previously added using addTests.

        proxy.disableAllTests()
        
- enableTest(testName) : Enables a test previously added using addTests.

        proxy.enableTest('TC1')

- disableTest(testName) : Disables a test previously added using addTests.

        proxy.disableTest('TC1')
  
Response object parameters:
---------
  Sample request object is provided in /samples/.
  Different values of a "req" parameter can be accessed like:
 
        - req.requestOptions.hostname
        - req.requestOptions.port
        - req.requestOptions.path
        - req.requestOptions.method
        - req.requestOptions.headers.Host
        - req.requestOptions.headers.Connection
        - req.requestOptions.headers['Access-Control-Request-Method']
        - req.requestOptions.headers['User-Agent']
        - req.protocol
        - req.url
        - req.requestData

Response object parameters:
---------
  Sample response object is provided in /samples/.
  Different values of a "res" parameter can be accessed like:
 
        - res.response.statusCode
        - res.response.header.Date
        - res.response.header.Server
        - res.response.header.Connection
        - res.response.header['Content-Type']
        - res.response.body
        - res.url
        - res.method
        - res.statusCode
        - res.statusMessage
        



