const mqtt = require('mqtt');
const client = mqtt.connect('wss://pf-ibsgd28puwdn8l7vi5y5.cedalo.cloud:443/mqtt', {
  username: "Web",
  password: "a",
  protocolVersion: 4,
  clientId: "webtest_" + Math.random().toString(16).slice(2)
});
client.on('connect', () => {
    console.log("Connected to Cedalo");
    process.exit(0);
});
client.on('error', (e) => {
    console.error("Cedalo error:", e.message);
    process.exit(1);
});
setTimeout(() => { console.log("Timeout Cedalo"); process.exit(1); }, 3000);
