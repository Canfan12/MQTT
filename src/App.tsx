import React, { useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import { Mic, MicOff, Power, Thermometer, Droplets, Server, Activity, ArrowRightLeft } from 'lucide-react';

const BROKERS = [
  {
    id: 0,
    name: "Ably",
    url: "wss://mqtt.ably.io", 
    user: "8L-ACg.rmAq2w",
    pass: "jV_2ZWFPPBYzVJbqCkDhqf-VzaNMRIXoAdie4u1N5pg",
    clientId: "esp32-web"
  },
  {
    id: 1,
    name: "CloudAMQP",
    url: "wss://kingfisher.lmq.cloudamqp.com/ws",
    user: "ragkazny:ragkazny",
    pass: "BBo6dOCdNAfHw16ttzevwO0BgbeAp-ck",
    clientId: `web_${Math.random().toString(16).slice(3)}`
  },
  {
    id: 2,
    name: "Cedalo",
    url: "wss://pf-ibsgd28puwdn8l7vi5y5.cedalo.cloud/mqtt",
    user: "Web",
    pass: "a",
    clientId: "WebClient"
  }
];

export default function App() {
  const [activeBrokerId, setActiveBrokerId] = useState(1);
  const [client, setClient] = useState<MqttClient | null>(null);
  const [status, setStatus] = useState("Disconnected");
  
  const [temperature, setTemperature] = useState("--");
  const [humidity, setHumidity] = useState("--");
  
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Use refs in voice callback to see latest state
  const tempRef = useRef(temperature);
  const humRef = useRef(humidity);
  
  useEffect(() => {
    tempRef.current = temperature;
    humRef.current = humidity;
  }, [temperature, humidity]);

  useEffect(() => {
    connectBroker(activeBrokerId);
    return () => {
      if (client) {
        client.end(true);
      }
    };
  }, []);

  const connectBroker = (brokerId: number) => {
    if (client) {
        client.end(true);
    }
    const broker = BROKERS[brokerId];
    setStatus(`Connecting to ${broker.name}...`);
    
    // In a browser context, mqtt.connect over WSS handles connection cleanly
    const newClient = mqtt.connect(broker.url, {
      username: broker.user,
      password: broker.pass,
      clientId: broker.clientId,
      reconnectPeriod: 5000,
      protocolVersion: 4,
      clean: true,
      keepalive: 60
    });

    newClient.on('connect', () => {
      setStatus(`Connected to ${broker.name}`);
      newClient.subscribe('sensor:suhu');
      newClient.subscribe('sensor:kelembaban');
    });

    newClient.on('message', (topic, message) => {
      const msg = message.toString();
      if (topic === 'sensor:suhu') setTemperature(msg);
      if (topic === 'sensor:kelembaban') setHumidity(msg);
      // Note: Relay state could be tracked if the ESP32 published it, 
      // but right now ESP32 only listens to 'kontrol:relayX'.
    });

    newClient.on('error', (err) => {
      console.error('MQTT error: ', err);
      setStatus(`Error: ${err.message}`);
    });
    
    newClient.on('close', () => {
       if (status.includes("Connected")) {
         setStatus("Disconnected");
       }
    });

    setClient(newClient);
  };

  const publishTopic = (topic: string, message: string) => {
    if (client && client.connected) {
      client.publish(topic, message);
    } else {
      console.warn("Cannot publish, not connected");
    }
  };

  const toggleRelay = (relayNum: number, state: boolean) => {
    publishTopic(`kontrol:relay${relayNum}`, state ? "ON" : "OFF");
  };

  const setVariasi = (mode: string) => {
    publishTopic('kontrol:variasi', mode);
  };

  const switchBrokerCommand = (newId: number) => {
    // Send command to ESP32 to switch
    publishTopic('kontrol:broker', newId.toString());
    
    // Switch locally as well, slight delay to allow ESP32 to receive it first
    setTimeout(() => {
      setActiveBrokerId(newId);
      connectBroker(newId);
    }, 1000);
  };

  const handleVoiceCommand = (command: string) => {
    const cmd = command.toLowerCase();
    
    // Relay Commands
    if (cmd.includes('hidupkan') || cmd.includes('nyalakan')) {
      if (cmd.includes('relay satu') || cmd.includes('relay 1')) toggleRelay(1, true);
      if (cmd.includes('relay dua') || cmd.includes('relay 2')) toggleRelay(2, true);
      if (cmd.includes('relay tiga') || cmd.includes('relay 3')) toggleRelay(3, true);
      if (cmd.includes('relay empat') || cmd.includes('relay 4')) toggleRelay(4, true);
    } else if (cmd.includes('matikan')) {
      if (cmd.includes('relay satu') || cmd.includes('relay 1')) toggleRelay(1, false);
      if (cmd.includes('relay dua') || cmd.includes('relay 2')) toggleRelay(2, false);
      if (cmd.includes('relay tiga') || cmd.includes('relay 3')) toggleRelay(3, false);
      if (cmd.includes('relay empat') || cmd.includes('relay 4')) toggleRelay(4, false);
    }
    
    // Variasi Commands
    if (cmd.includes('variasi satu') || cmd.includes('variasi 1')) setVariasi('1');
    if (cmd.includes('variasi dua') || cmd.includes('variasi 2')) setVariasi('2');
    if (cmd.includes('stop variasi') || cmd.includes('berhenti') || cmd.includes('stop')) setVariasi('STOP');

    // Sensor Readings (TTS)
    if (cmd.includes('berapa suhu') || cmd.includes('suhu saat ini')) {
      speak(`Suhu saat ini adalah ${tempRef.current} derajat celcius`);
    } else if (cmd.includes('berapa kelembaban') || cmd.includes('kelembaban saat ini')) {
      speak(`Kelembaban saat ini adalah ${humRef.current} persen`);
    }
  };

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'id-ID';
    window.speechSynthesis.speak(utterance);
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Browser Anda tidak mendukung fitur Web Speech API (Voice Command). Gunakan Google Chrome desktop.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'id-ID';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setIsListening(true);
    
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      console.log('Voice heard:', transcript);
      handleVoiceCommand(transcript);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech error:', event.error);
      setIsListening(false);
    };

    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
  };

  return (
    <div className="h-screen w-full flex flex-col bg-slate-100 text-slate-800 overflow-hidden font-sans">
      
      <header className="h-[60px] bg-slate-800 text-white flex items-center justify-between px-6 border-b-4 border-blue-600 shrink-0">
        <div className="flex items-center gap-3">
          <Power className="w-6 h-6" />
          <h1 className="text-xl font-bold tracking-tight m-0">SMART IOT CONTROLLER</h1>
        </div>
        <div className="flex items-center">
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${status.includes('Connected') ? 'bg-green-500/20 text-green-400' : status.includes('Connecting') ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400'}`}>
            <div className={`w-2 h-2 rounded-full ${status.includes('Connected') ? 'bg-green-500' : status.includes('Connecting') ? 'bg-amber-500' : 'bg-red-500'}`}></div>
            {status.toUpperCase()}
          </div>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[280px_1fr_300px] gap-4 p-4 box-border overflow-y-auto">
        
        {/* Left Column - Sensors */}
        <div className="bg-white border border-slate-200 rounded-lg flex flex-col overflow-hidden h-fit">
          <div className="px-4 py-3 border-b border-slate-200 font-semibold text-sm text-slate-500 uppercase tracking-wider flex items-center justify-between">
            ENVIRONMENTAL SENSORS
          </div>
          
          <div className="py-6 px-4 text-center">
            <div className="text-xs uppercase mb-2 text-slate-500 font-semibold">Temperature</div>
            <div className="text-5xl font-light text-blue-600 leading-none">
              {temperature}<span className="text-base text-slate-500 ml-1">°C</span>
            </div>
          </div>
          
          <div className="h-px bg-slate-200"></div>
          
          <div className="py-6 px-4 text-center">
            <div className="text-xs uppercase mb-2 text-slate-500 font-semibold">Humidity</div>
            <div className="text-5xl font-light text-blue-600 leading-none">
              {humidity}<span className="text-base text-slate-500 ml-1">%</span>
            </div>
          </div>
          <div className="flex-1"></div>
          <div className="p-4 bg-slate-50 text-xs text-slate-500 border-t border-slate-200">
            Live MQTT feed
          </div>
        </div>

        {/* Center Column - Controls */}
        <div className="bg-white border border-slate-200 rounded-lg flex flex-col overflow-hidden h-fit">
          <div className="px-4 py-3 border-b border-slate-200 font-semibold text-sm text-slate-500 uppercase tracking-wider flex items-center justify-between">
            MANUAL RELAY CONTROL
          </div>
          
          <div className="grid grid-cols-2 gap-3 p-4 flex-1">
            {[1, 2, 3, 4].map((num) => (
              <div key={num} className="bg-slate-50 border border-slate-200 rounded-md p-4 flex flex-col items-center gap-3">
                 <div className="font-semibold text-sm">RELAY {num}</div>
                 <div className="flex gap-2 w-full">
                    <button 
                      onClick={() => toggleRelay(num, true)}
                      className="flex-1 bg-white hover:bg-green-50 text-slate-500 hover:text-green-600 border border-slate-200 hover:border-green-300 rounded block py-1 text-xs font-bold transition-colors"
                    >
                      ON
                    </button>
                    <button 
                      onClick={() => toggleRelay(num, false)}
                      className="flex-1 bg-white hover:bg-slate-100 text-slate-500 border border-slate-200 rounded block py-1 text-xs font-bold transition-colors"
                    >
                      OFF
                    </button>
                  </div>
              </div>
            ))}
          </div>

          <div className="px-4 py-3 border-t border-b border-slate-200 font-semibold text-sm text-slate-500 uppercase tracking-wider">
            VARIATION MODES
          </div>
          <div className="p-4 flex gap-2 w-full">
            <button 
               onClick={() => setVariasi('1')}
               className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-800 border-none p-2 rounded text-xs font-semibold cursor-pointer transition-colors"
             >
               VARIASI 1
             </button>
             <button 
               onClick={() => setVariasi('2')}
               className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-800 border-none p-2 rounded text-xs font-semibold cursor-pointer transition-colors"
             >
               VARIASI 2
             </button>
             <button 
               onClick={() => setVariasi('STOP')}
               className="flex-1 bg-red-500 hover:bg-red-600 text-white border-none p-2 rounded text-xs font-semibold cursor-pointer transition-colors"
             >
               STOP
             </button>
          </div>
        </div>

        {/* Right Column - Broker Config */}
        <div className="bg-white border border-slate-200 rounded-lg flex flex-col overflow-hidden h-fit">
          <div className="px-4 py-3 border-b border-slate-200 font-semibold text-sm text-slate-500 uppercase tracking-wider">
            MQTT BROKER CONFIG
          </div>
          
          <div className="flex flex-col">
            {BROKERS.map((broker) => {
              const isActive = activeBrokerId === broker.id;
              return (
                <div 
                  key={broker.id}
                  onClick={() => !isActive && switchBrokerCommand(broker.id)}
                  className={`flex items-center justify-between p-3 border-b border-slate-200 cursor-pointer ${isActive ? 'bg-blue-600/5 border-l-4 border-l-blue-600' : 'hover:bg-slate-50 border-l-4 border-l-transparent'}`}
                >
                  <div className="flex flex-col">
                     <div className="font-semibold text-sm">{broker.name.toUpperCase()} (Broker {broker.id})</div>
                     <div className="text-xs text-slate-500 font-mono mt-0.5 max-w-[180px] truncate">{broker.url.replace('wss://','')}</div>
                  </div>
                  {isActive && <div className="w-2 h-2 rounded-full bg-green-500"></div>}
                </div>
              );
            })}
          </div>
          
        </div>
      </main>

      {/* Terminal / Voice console area */}
      <div className="mx-4 mb-4 mt-0 bg-white border border-slate-200 rounded-xl flex flex-col md:flex-row overflow-hidden shrink-0 shadow-sm h-[120px]">
        
        <div className="flex-1 bg-slate-900 text-sky-400 p-4 font-mono text-xs overflow-y-auto">
          <div className="mb-1"><span className="text-slate-400">&gt;</span> System ready for voice commands...</div>
          {!isListening && <div className="mb-1"><span className="text-slate-400">&gt;</span> Click the mic button to start listening.</div>}
          {isListening && <div className="mb-1"><span className="text-slate-400">&gt;</span> Listening...</div>}
          <div className="mb-1 text-slate-500">// Speak commands like "Nyalakan Relay satu", "Berapa suhu", "Variasi satu"</div>
        </div>

        <div className="bg-slate-800 p-4 flex items-center gap-4 w-full md:w-auto md:min-w-[300px]">
          <button 
            onClick={toggleListening}
            className={`w-12 h-12 rounded-full flex items-center justify-center cursor-pointer border-none transition-transform ${isListening ? 'bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.4)] scale-110' : 'bg-slate-700 hover:bg-slate-600 shadow-none'}`}
          >
            {isListening ? <Mic className="w-6 h-6 text-white" /> : <MicOff className="w-6 h-6 text-white text-opacity-50" />}
          </button>
          <div>
            <div className="font-bold text-sm text-white">Voice Assistant</div>
            <div className="text-xs text-slate-400">{isListening ? 'Listening now...' : 'Click to command device'}</div>
          </div>
        </div>

      </div>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 px-6 py-3 flex items-center justify-between text-xs text-slate-500 shrink-0 mt-auto">
        <div>&copy; 2024 ESP32 Web Interface | Built for Vercel Deployment</div>
        <div className="flex gap-4 hidden sm:flex">
          <span>DHT11 Health: <span className="text-green-500 font-medium">98%</span></span>
          <span>MQTT Latency: <span className="text-green-500 font-medium">42ms</span></span>
        </div>
      </footer>

    </div>
  );
}
