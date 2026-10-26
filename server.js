const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

const PORT = 3000;

const COUNTRY_OUTLETS = {
  'Japan'    : 'bd0hskvlodi14alfsom98pqi',
  'DACH'     : '14c4m63ov2fei1f3pfh9tgrfdf',
  'Canada'   : 'wbac02p8ie5111jaeapaal6kq',
  'US'       : 's99r43e6vzn01rtfokcnlvjwx',
  'Italy'    : 'a0sqbsvz8yk81pdzyznddokcs',
  'Spain'    : 'dabpujpe1o7p1uyx9k1fcoaia',
  'Brazil'   : 'e53b0s82vpnv1epl6ckjib5hb',
  'ROW'      : '1vw4a7d9kk73m1kurl4hsvzl59',
  'Belgium'  : '1s01myh4xwvs91gp8tqvwllj76',
  'France'   : '1h9emivijm87d13yxr38arhw4f',
  'Portugal' : 'c9qhvff9uz21skuh4zctiz1n',
  'Taiwan'   : '1ovfmjfvdq1321dpuxti2x2c8q',
  'Central'  : '1d6kywwtz568311m986sys4vhm'
};

const API_FIELDS = '?_fmt=json&_rt=b&_fld=oaId,cmId,dc,ccc,mta,ptr,ac,heETN,heR,drm,rsid,cc,rid,desc,oid,al,sst,set,wmk,lnk.urn:perform:mfl:fixture,lmt&_als=l&_ord=sst&_ordSrt=asc&_pgSz=1000';

const MKEAE_DCG = 'https://cluster-1.uksouth-3.streaming.mediakind.com/dazn/events';
const MKEAE_DCH = 'https://cluster-1.westeurope-3.streaming.mediakind.com/dazn/events';

/* ─────────────────────────────────────────────
   GENERIC HTTPS GET
───────────────────────────────────────────── */
function httpsGet(targetUrl, timeoutMs) {
  timeoutMs = timeoutMs || 20000;
  return new Promise(function(resolve) {
    var parsed  = url.parse(targetUrl);
    var options = {
      hostname : parsed.hostname,
      path     : parsed.path,
      method   : 'GET',
      headers  : {
        'Accept'     : 'application/json',
        'User-Agent' : 'DAZN-Dashboard/1.0'
      }
    };

    var req = https.request(options, function(res) {
      var body = '';
      res.on('data', function(chunk) { body += chunk; });
      res.on('end', function() {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body), raw: body });
        } catch(e) {
          resolve({ status: res.statusCode, data: null, raw: body,
                    error: 'JSON parse error: ' + e.message });
        }
      });
    });

    req.on('error', function(err) {
      resolve({ status: 500, data: null, error: err.message });
    });

    req.setTimeout(timeoutMs, function() {
      req.destroy();
      resolve({ status: 504, data: null,
                error: 'Request timeout after ' + timeoutMs + 'ms' });
    });

    req.end();
  });
}

/* ─────────────────────────────────────────────
   FETCH ONE DAZN OUTLET
───────────────────────────────────────────── */
function fetchOutlet(country, outlet) {
  var targetUrl = 'https://api.daznfeeds.com/livestream/' + outlet + '/' + API_FIELDS;
  console.log('[DAZN] Fetching ' + country + ' → ' + outlet);
  return httpsGet(targetUrl, 15000).then(function(result) {
    return {
      country : country,
      status  : result.status,
      data    : result.data,
      error   : result.error || null
    };
  });
}

/* ─────────────────────────────────────────────
   PARSE MK-EAE RAW RESPONSE
───────────────────────────────────────────── */
function parseMkEaeResponse(raw) {
  var events = [];
  if (!raw) return events;

  if (Array.isArray(raw)) {
    raw.forEach(function(item) {
      if (item && item.event)                    events.push(item.event);
      else if (item && typeof item === 'object') events.push(item);
    });
  } else if (raw && Array.isArray(raw.events)) {
    raw.events.forEach(function(item) {
      if (item && item.event) events.push(item.event);
      else if (item)          events.push(item);
    });
  } else if (raw && Array.isArray(raw.data)) {
    raw.data.forEach(function(item) {
      if (item && item.event) events.push(item.event);
      else if (item)          events.push(item);
    });
  } else if (raw && raw.event) {
    events.push(raw.event);
  }
  return events;
}

/* ─────────────────────────────────────────────
   FETCH MK-EAE (DCG or DCH)
───────────────────────────────────────────── */
function fetchMkEae(baseUrl, label) {
  console.log('[MKEAE-' + label + '] Fetching → ' + baseUrl);
  return httpsGet(baseUrl, 30000).then(function(result) {
    if (result.error) {
      console.error('[MKEAE-' + label + '] Error:', result.error);
      return { status: result.status, events: [], error: result.error, source: label };
    }
    var events = parseMkEaeResponse(result.data);
    console.log('[MKEAE-' + label + '] Parsed ' + events.length + ' events');
    return { status: result.status, events: events, error: null, source: label };
  });
}

/* ─────────────────────────────────────────────
   HTTP SERVER
───────────────────────────────────────────── */
http.createServer(function(req, res) {

  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  var parsedUrl = url.parse(req.url, true);
  var pathname  = parsedUrl.pathname;

  /* ── index.html ── */
  if (pathname === '/' || pathname === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), function(err, data) {
      if (err) { res.writeHead(404); res.end('index.html not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  /* ── outlets list ── */
  if (pathname === '/api/outlets') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(COUNTRY_OUTLETS));
    return;
  }

  /* ── single country ── */
  if (pathname === '/api/streams') {
    var country = parsedUrl.query.country;
    if (!country || !COUNTRY_OUTLETS[country]) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid or missing country parameter.' }));
      return;
    }
    fetchOutlet(country, COUNTRY_OUTLETS[country]).then(function(result) {
      res.writeHead(result.status || 200, {
        'Content-Type'                : 'application/json',
        'Access-Control-Allow-Origin' : '*'
      });
      res.end(JSON.stringify(result.data));
    });
    return;
  }

  /* ── all regions ── */
  if (pathname === '/api/streams/all') {
    var countries = Object.keys(COUNTRY_OUTLETS);
    Promise.all(countries.map(function(c) {
      return fetchOutlet(c, COUNTRY_OUTLETS[c]);
    })).then(function(results) {
      var combined = {};
      results.forEach(function(r) {
        combined[r.country] = {
          status : r.status,
          data   : r.data,
          error  : r.error || null
        };
      });
      res.writeHead(200, {
        'Content-Type'                : 'application/json',
        'Access-Control-Allow-Origin' : '*'
      });
      res.end(JSON.stringify(combined));
    });
    return;
  }

  /* ── MK-EAE DCG ── */
  if (pathname === '/api/mkeae/dcg') {
    fetchMkEae(MKEAE_DCG, 'DCG').then(function(result) {
      res.writeHead(200, {
        'Content-Type'                : 'application/json',
        'Access-Control-Allow-Origin' : '*'
      });
      res.end(JSON.stringify(result));
    });
    return;
  }

  /* ── MK-EAE DCH ── */
  if (pathname === '/api/mkeae/dch') {
    fetchMkEae(MKEAE_DCH, 'DCH').then(function(result) {
      res.writeHead(200, {
        'Content-Type'                : 'application/json',
        'Access-Control-Allow-Origin' : '*'
      });
      res.end(JSON.stringify(result));
    });
    return;
  }

  /* ── MK-EAE both (DCG + DCH) ── */
  if (pathname === '/api/mkeae/all') {
    Promise.all([
      fetchMkEae(MKEAE_DCG, 'DCG'),
      fetchMkEae(MKEAE_DCH, 'DCH')
    ]).then(function(results) {
      res.writeHead(200, {
        'Content-Type'                : 'application/json',
        'Access-Control-Allow-Origin' : '*'
      });
      res.end(JSON.stringify({ dcg: results[0], dch: results[1] }));
    });
    return;
  }

  /* ── legacy compatibility ── */
  if (pathname === '/api/mkeae') {
    fetchMkEae(MKEAE_DCG, 'DCG').then(function(result) {
      res.writeHead(200, {
        'Content-Type'                : 'application/json',
        'Access-Control-Allow-Origin' : '*'
      });
      res.end(JSON.stringify(result));
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');

}).listen(PORT, function() {
  console.log('========================================');
  console.log('  DAZN Dashboard Server running!');
  console.log('  http://localhost:' + PORT);
  console.log('  Regions: ' + Object.keys(COUNTRY_OUTLETS).join(', '));
  console.log('  MK-EAE DCG: ' + MKEAE_DCG);
  console.log('  MK-EAE DCH: ' + MKEAE_DCH);
  console.log('========================================');
});
