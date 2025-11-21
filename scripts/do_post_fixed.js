const fs = require('fs');
const http = require('http');
(async ()=>{
  try{
    const payload = fs.readFileSync('/tmp/test_payload.json','utf8');
    let token = '';
    try{ token = fs.readFileSync('/tmp/token.txt','utf8').replace(/\n/g,''); } catch(e){}
    const options = {
      method: 'POST',
      hostname: 'localhost',
      port: 3001,
      path: '/api/pedidos-venta/20/items',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        console.log('STATUS', res.statusCode);
        try{ console.log(JSON.stringify(JSON.parse(data), null, 2)); } catch(e){ console.log(data); }
      });
    });
    req.on('error', (e) => { console.error('request error', e); process.exit(2); });
    req.write(payload);
    req.end();
  }catch(e){ console.error('fatal', e); process.exit(3); }
})();
