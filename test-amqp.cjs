const mqtt = require('mqtt');
const client = mqtt.connect('wss://kingfisher.lmq.cloudamqp.com:443/ws', {
  username: "ragkazny:ragkazny",
  password: "BBo6dOCdNAfHw16ttzevwO0BgbeAp-ck",
  protocolVersion: 4,
  clientId: "webtest_" + Math.random().toString(16).slice(2)
});
client.on('connect', () => {
    console.log("Connected to AMQP");
    process.exit(0);
});
client.on('error', (e) => {
    console.error("AMQP error:", e.message);
    process.exit(1);
});
setTimeout(() => { console.log("Timeout AMQP"); process.exit(1); }, 3000);
