#define MQTT_MAX_PACKET_SIZE 512

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include "DHT.h"

// =============================================================
// KONFIGURASI WIFI
// =============================================================
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// =============================================================
// KONFIGURASI PIN
// =============================================================
#define RELAY1_PIN 5
#define RELAY2_PIN 19
#define RELAY3_PIN 18
#define RELAY4_PIN 23
#define DHT_PIN    4
#define DHT_TYPE   DHT11

const int RELAY_PINS[4] = { RELAY1_PIN, RELAY2_PIN, RELAY3_PIN, RELAY4_PIN };

// =============================================================
// KONFIGURASI 3 BROKER
// =============================================================
struct BrokerConfig {
  const char* server;
  int         port;
  const char* user;
  const char* pass;
  const char* clientId;
};

const BrokerConfig BROKERS[3] = {
  // Broker 0 – Ably
  {
    "mqtt.ably.io",
    8883,
    "YOUR_ABLY_USERNAME", // Contoh format: "api-key-name"
    "YOUR_ABLY_PASSWORD", // Contoh format: "api-key-secret"
    "esp32-relay-01"
  },
  // Broker 1 – CloudAMQP
  {
    "kingfisher.lmq.cloudamqp.com",
    8883,
    "YOUR_CLOUDAMQP_USERNAME",
    "YOUR_CLOUDAMQP_PASSWORD",
    "amqpesp"
  },
  // Broker 2 – Cedalo
  {
    "pf-ibsgd28puwdn8l7vi5y5.cedalo.cloud",
    8883,
    "YOUR_CEDALO_USERNAME",
    "YOUR_CEDALO_PASSWORD",
    "EspClient"
  }
};

int activeBroker = 0;   // Default broker: Ably
bool brokerSwitchRequest = false;
int  brokerSwitchTarget  = 0;

// =============================================================
// TOPIK MQTT
// =============================================================
#define TOPIC_RELAY1      "kontrol:relay1"
#define TOPIC_RELAY2      "kontrol:relay2"
#define TOPIC_RELAY3      "kontrol:relay3"
#define TOPIC_RELAY4      "kontrol:relay4"
#define TOPIC_VARIASI     "kontrol:variasi"
#define TOPIC_BROKER      "kontrol:broker"
#define TOPIC_SUHU        "sensor:suhu"
#define TOPIC_KELEMBABAN  "sensor:kelembaban"

// =============================================================
// STATE GLOBAL
// =============================================================
int           variasiMode     = 0;
int           variasiStep     = 0;
unsigned long variasiLastTime = 0;
const unsigned long VARIASI_JEDA = 50;

unsigned long lastSensorTime        = 0;
const unsigned long SENSOR_INTERVAL = 5000;

// =============================================================
// OBJEK UTAMA
// =============================================================
WiFiClientSecure wifiClient;
PubSubClient     mqttClient(wifiClient);
DHT              dht(DHT_PIN, DHT_TYPE);

// =============================================================
// UTILITAS
// =============================================================
String trimStr(String s) {
  int a = 0, b = s.length() - 1;
  while (a <= b && (s[a] == ' ' || s[a] == '\t' || s[a] == '\r' || s[a] == '\n')) a++;
  while (b >= a && (s[b] == ' ' || s[b] == '\t' || s[b] == '\r' || s[b] == '\n')) b--;
  return s.substring(a, b + 1);
}

// =============================================================
// WIFI
// =============================================================
void setupWifi() {
  Serial.print("\n[WiFi] Menghubungkan ke ");
  Serial.print(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\n[WiFi] Terhubung | IP: " + WiFi.localIP().toString());
  wifiClient.setInsecure(); // Mengabaikan validasi sertifikat SSL/TLS untuk mempermudah
}

// =============================================================
// RELAY
// =============================================================
void allRelayOff() {
  for (int i = 0; i < 4; i++) digitalWrite(RELAY_PINS[i], HIGH);
}

void setRelay(int idx, bool on) {
  digitalWrite(RELAY_PINS[idx], on ? LOW : HIGH);
  Serial.printf("[Relay] %d => %s\n", idx + 1, on ? "ON" : "OFF");
}

// =============================================================
// VARIASI RELAY
// Variasi 1 : Relay 1→2→3→4 (loop)
// Variasi 2 : Relay 4→3→2→1 (loop)
// =============================================================
void handleVariasi() {
  if (variasiMode == 0) return;
  unsigned long now = millis();
  if (now - variasiLastTime < VARIASI_JEDA) return;
  variasiLastTime = now;

  const int urutan1[4] = {0, 1, 2, 3};
  const int urutan2[4] = {3, 2, 1, 0};

  allRelayOff();
  int relayIdx = (variasiMode == 1)
    ? urutan1[variasiStep % 4]
    : urutan2[variasiStep % 4];

  digitalWrite(RELAY_PINS[relayIdx], LOW);
  Serial.printf("[Variasi %d | %lums] Relay %d ON\n", variasiMode, VARIASI_JEDA, relayIdx + 1);
  variasiStep++;
}

// =============================================================
// MQTT – SUBSCRIBE
// =============================================================
void subscribeAll() {
  mqttClient.subscribe(TOPIC_RELAY1);
  mqttClient.subscribe(TOPIC_RELAY2);
  mqttClient.subscribe(TOPIC_RELAY3);
  mqttClient.subscribe(TOPIC_RELAY4);
  mqttClient.subscribe(TOPIC_VARIASI);
  mqttClient.subscribe(TOPIC_BROKER);
  Serial.println("[MQTT] Subscribe semua topik berhasil.");
}

// =============================================================
// MQTT – CONNECT ke broker aktif
// =============================================================
void connectBroker() {
  const BrokerConfig& b = BROKERS[activeBroker];
  mqttClient.setServer(b.server, b.port);

  Serial.printf("\n[MQTT] Broker %d | %s:%d\n", activeBroker, b.server, b.port);

  while (!mqttClient.connected()) {
    Serial.print("[MQTT] Menghubungkan... ");
    if (mqttClient.connect(b.clientId, b.user, b.pass)) {
      Serial.println("BERHASIL!");
      subscribeAll();
    } else {
      Serial.printf("Gagal! state=%d | Coba lagi 4 detik...\n", mqttClient.state());
      delay(4000);
    }
  }
}

void reconnect() {
  connectBroker();
}

// =============================================================
// MQTT – CALLBACK
// =============================================================
void callback(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  msg = trimStr(msg);
  Serial.println("[RX] " + String(topic) + " => '" + msg + "'");

  // ---- PINDAH BROKER ----
  if (String(topic) == TOPIC_BROKER) {
    int target = msg.toInt();
    if (target >= 0 && target <= 2 && target != activeBroker) {
      Serial.printf("[Broker] Pindah ke broker %d...\n", target);
      brokerSwitchRequest = true;
      brokerSwitchTarget  = target;
    } else if (target == activeBroker) {
      Serial.printf("[Broker] Sudah menggunakan broker %d.\n", activeBroker);
    } else {
      Serial.println("[Broker] Target tidak valid (0/1/2).");
    }
    return;
  }

  // ---- MODE VARIASI ----
  if (String(topic) == TOPIC_VARIASI) {
    if (msg == "1") {
      variasiMode = 1; variasiStep = 0; variasiLastTime = 0;
      Serial.printf("[Variasi] Mode 1 aktif – 1→2→3→4 | %lu ms\n", VARIASI_JEDA);
    } else if (msg == "2") {
      variasiMode = 2; variasiStep = 0; variasiLastTime = 0;
      Serial.printf("[Variasi] Mode 2 aktif – 4→3→2→1 | %lu ms\n", VARIASI_JEDA);
    } else if (msg == "STOP") {
      variasiMode = 0; variasiStep = 0;
      allRelayOff();
      Serial.println("[Variasi] Dihentikan.");
    }
    return;
  }

  // ---- KONTROL RELAY MANUAL ----
  if (variasiMode != 0) {
    Serial.println("[Info] Variasi aktif – kirim STOP dulu.");
    return;
  }

  bool on = (msg == "ON");
  if      (String(topic) == TOPIC_RELAY1) setRelay(0, on);
  else if (String(topic) == TOPIC_RELAY2) setRelay(1, on);
  else if (String(topic) == TOPIC_RELAY3) setRelay(2, on);
  else if (String(topic) == TOPIC_RELAY4) setRelay(3, on);
}

// =============================================================
// SETUP
// =============================================================
void setup() {
  Serial.begin(115200);

  for (int i = 0; i < 4; i++) {
    pinMode(RELAY_PINS[i], OUTPUT);
    digitalWrite(RELAY_PINS[i], HIGH);
  }

  dht.begin();
  setupWifi();

  mqttClient.setCallback(callback);
  connectBroker();
}

// =============================================================
// LOOP
// =============================================================
void loop() {
  // Eksekusi pindah broker di loop (aman di luar callback)
  if (brokerSwitchRequest) {
    brokerSwitchRequest = false;
    mqttClient.disconnect();
    delay(500);
    activeBroker = brokerSwitchTarget;
    variasiMode  = 0;
    variasiStep  = 0;
    allRelayOff();
    connectBroker();
  }

  if (WiFi.status() != WL_CONNECTED) setupWifi();
  if (!mqttClient.connected()) reconnect();

  mqttClient.loop();
  handleVariasi();

  unsigned long now = millis();
  if (now - lastSensorTime >= SENSOR_INTERVAL) {
    lastSensorTime = now;

    float h = dht.readHumidity();
    float t = dht.readTemperature();

    if (!isnan(h) && !isnan(t)) {
      char buf[16];
      dtostrf(t, 4, 1, buf);
      mqttClient.publish(TOPIC_SUHU, buf);
      Serial.printf("[Sensor] Suhu: %s°C\n", buf);

      dtostrf(h, 4, 1, buf);
      mqttClient.publish(TOPIC_KELEMBABAN, buf);
      Serial.printf("[Sensor] Kelembaban: %s%%\n", buf);
    } else {
      Serial.println("[Sensor] Gagal membaca DHT11!");
    }
  }
}
