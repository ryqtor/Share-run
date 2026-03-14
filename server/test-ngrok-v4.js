const ngrok = require('ngrok');
const http = require('http');

const server = http.createServer((req, res) => res.end('ok'));
server.listen(5001, async () => {
  try {
    console.log('Connecting...');
    const url = await ngrok.connect({
      addr: 5001,
      authtoken: '3AuDiAvDqc0JBOKyjIMpa3yxaKg_7tSUpLH9k5vXKUJmrXo1J'
    });
    console.log('SUCCESS:', url);
    await ngrok.disconnect();
    await ngrok.kill();
    process.exit(0);
  } catch (err) {
    console.error('ERROR OCCURRED:', err);
    process.exit(1);
  }
});
