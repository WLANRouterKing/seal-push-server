import WebSocket from 'ws';

const pubkey = 'b220b439bbb3d7b55ea43b0d0fc2ed87d747276d67315f8f9f3d3fcf73f32867'; // Desktop
const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.snort.social'];

for (const relay of relays) {
  const ws = new WebSocket(relay);

  ws.on('open', () => {
    console.log(`\n[${relay}] Connected`);
    const req = JSON.stringify(['REQ', 'test', { kinds: [1059], '#p': [pubkey], limit: 5 }]);
    ws.send(req);
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg[0] === 'EVENT') {
      const e = msg[2];
      console.log(`[${relay}] EVENT: ${e.id.slice(0,16)}... created: ${new Date(e.created_at * 1000).toISOString()}`);
    } else if (msg[0] === 'EOSE') {
      console.log(`[${relay}] EOSE - done`);
      ws.close();
    }
  });

  ws.on('error', (e) => console.error(`[${relay}] Error:`, e.message));
}

setTimeout(() => process.exit(0), 10000);
