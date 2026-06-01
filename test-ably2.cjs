const mqtt = require('mqtt');
const client = mqtt.connect('wss://mqtt.ably.io:443', {
  username: "8L-ACg.rmAq2w",
  password: "jV_2ZWFPPBYzVJbqCkDhqf-VzaNMRIXoAdie4u1N5pg",
  protocolVersion: 4,
  clientId: "esp32-web"
});
client.on('connect', () => {
    console.log("Connected to Ably with esp32-web");
    process.exit(0);
});
client.on('error', (e) => {
    console.error("Ably error:", e.message);
    process.exit(1);
});
setTimeout(() => { console.log("Timeout Ably"); process.exit(1); }, 3000);
