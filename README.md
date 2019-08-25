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
   

API Reference
------------

- start() : Starts the Proxy Server without storing results.

        proxy.start()

- startAndRecord() : Starts the Proxy Server and stores results into allRecords and filteredRecords (if any filter is available).

        proxy.startAndRecord()

- stop() : 

        proxy.stop()
    
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

        function simpleFilter(response) {
             if (response.url.toString().includes('api.test.net')) {
                 if(response.statusCode == 200) {
                   if (response.url.toString().endsWith(".pdf")){
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


