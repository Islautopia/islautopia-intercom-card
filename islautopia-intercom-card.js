// Diccionario global de traducciones para Tarjeta y Editor (Top 9 Idiomas + HA Community)
const islautopiaLocales = {
  es: { // Español
    connecting: "🟢 Conectando...", live: "🟢 En directo", open: "🔴 Comms Abiertas", error_cam: "❌ Error",
    ed_stream: "Nombre del Stream (Ej: videoportero)", ed_url: "URL go2rtc externa (Opcional)",
    ed_entity: "Entidad de Apertura/Relé (Opcional)", ed_duration: "Segundos de Auto-Cierre (1-20)", ed_height: "Altura de la tarjeta (Ej: 400px, 600px, auto)"
  },
  en: { // Inglés (Fallback global)
    connecting: "🟢 Connecting...", live: "🟢 Live", open: "🔴 Comms Open", error_cam: "❌ Error",
    ed_stream: "Stream Name (Ex: videoportero)", ed_url: "External go2rtc URL (Optional)",
    ed_entity: "Unlock/Relay Entity (Optional)", ed_duration: "Auto-Close Seconds (1-20)", ed_height: "Card Height (Ex: 400px, 600px, auto)"
  },
  pt: { // Portugués
    connecting: "🟢 Conectando...", live: "🟢 Ao vivo", open: "🔴 Comms Abertas", error_cam: "❌ Erro",
    ed_stream: "Nome do Stream (Ex: videoportero)", ed_url: "URL go2rtc externa (Opcional)",
    ed_entity: "Entidade de Abertura/Relé (Opcional)", ed_duration: "Segundos para Fechar (1-20)", ed_height: "Altura do Cartão (Ex: 400px, 600px, auto)"
  },
  de: { // Alemán
    connecting: "🟢 Verbinde...", live: "🟢 Live", open: "🔴 Komm. offen", error_cam: "❌ Fehler",
    ed_stream: "Stream-Name (Bsp: videoportero)", ed_url: "Externe go2rtc URL (Optional)",
    ed_entity: "Türöffner/Relais Entität (Optional)", ed_duration: "Auto-Schließen Sekunden (1-20)", ed_height: "Kartenhöhe (Bsp: 400px, 600px, auto)"
  },
  fr: { // Francés
    connecting: "🟢 Connexion...", live: "🟢 En direct", open: "🔴 Comms Ouvertes", error_cam: "❌ Erreur",
    ed_stream: "Nom du flux (Ex: videoportero)", ed_url: "URL go2rtc externe (Optionnel)",
    ed_entity: "Entité de déverrouillage/relais (Optionnel)", ed_duration: "Secondes de fermeture auto (1-20)", ed_height: "Hauteur de la carte (Ex: 400px, 600px, auto)"
  },
  ru: { // Ruso
    connecting: "🟢 Подключение...", live: "🟢 В прямом эфире", open: "🔴 Связь открыта", error_cam: "❌ Ошибка",
    ed_stream: "Имя потока (Напр: videoportero)", ed_url: "Внешний URL go2rtc (Необязательно)",
    ed_entity: "Объект отпирания/реле (Необязательно)", ed_duration: "Секунды авто-закрытия (1-20)", ed_height: "Высота карточки (Напр: 400px, 600px, auto)"
  },
  zh: { // Chino Mandarín
    connecting: "🟢 连接中...", live: "🟢 直播中", open: "🔴 通话中", error_cam: "❌ 错误",
    ed_stream: "流名称 (例: videoportero)", ed_url: "外部 go2rtc URL (可选)",
    ed_entity: "解锁/继电器实体 (可选)", ed_duration: "自动关闭秒数 (1-20)", ed_height: "卡片高度 (例: 400px, 600px, auto)"
  },
  hi: { // Hindi
    connecting: "🟢 कनेक्ट हो रहा है...", live: "🟢 लाइव", open: "🔴 संचार चालू", error_cam: "❌ त्रुटि",
    ed_stream: "स्ट्रीम का नाम (उदा: videoportero)", ed_url: "बाहरी go2rtc URL (वैकल्पिक)",
    ed_entity: "अनलॉक/रिले एंटिटी (वैकल्पिक)", ed_duration: "ऑटो-क्लोज़ सेकंड (1-20)", ed_height: "कार्ड की ऊंचाई (उदा: 400px, 600px, auto)"
  },
  ar: { // Árabe
    connecting: "🟢 جارٍ الاتصال...", live: "🟢 مباشر", open: "🔴 اتصال مفتوح", error_cam: "❌ خطأ",
    ed_stream: "اسم البث (مثال: videoportero)", ed_url: "رابط go2rtc الخارجي (اختياري)",
    ed_entity: "كيان الفتح/المُرحِّل (اختياري)", ed_duration: "ثواني الإغلاق التلقائي (1-20)", ed_height: "ارتفاع البطاقة (مثال: 400px، 600px، auto)"
  }
};

function getLocalText(hass, key) {
  // 1. Si no hay idioma configurado en HA, asumimos inglés ('en')
  const lang = (hass && hass.language) ? hass.language.substring(0, 2) : 'en';
  
  // 2. Si el idioma detectado NO existe en nuestro diccionario (ej. 'fr' o 'de'), forzamos inglés ('en')
  return islautopiaLocales[islautopiaLocales[lang] ? lang : 'en'][key];
}
class IslautopiaIntercomCard extends HTMLElement {
  static async getConfigElement() {
    return document.createElement('islautopia-intercom-card-editor');
  }

  static getStubConfig() {
    return { stream: "videoportero", height: "auto", unlock_duration: 3 };
  }

  set hass(hass) { this._hass = hass; }

  setConfig(config) {
    if (!config.stream) throw new Error('Debes definir "stream" (el flujo de go2rtc)');
    this.config = config;
    this.mode = config.go2rtc_url ? 'go2rtc_standard' : 'islautopia_gateway'; 

    this.intercomActive = false;
    this.pc = null;
    this.vlcWS = null;
    this.localAudioStream = null;
    this.dummyAudioTrack = null;
    
    this.render();
  }

  getCardSize() { return 4; }

  connectedCallback() {
    if (this.content && !this.pc) this.startWebRTC();
  }

  disconnectedCallback() {
    if (this.pc) { this.pc.close(); this.pc = null; }
    if (this.vlcWS) { this.vlcWS.close(); this.vlcWS = null; }
    if (this.localAudioStream) {
      this.localAudioStream.getTracks().forEach(track => track.stop());
      this.localAudioStream = null;
    }
    this.intercomActive = false;
    if (this.intercomButton) {
      this.intercomButton.classList.remove('active-intercom');
      this.intercomIcon.setAttribute('icon', 'mdi:microphone-off');
      this.badge.textContent = getLocalText(this._hass, 'connecting');
      if (this.videoEl) this.videoEl.muted = true;
    }
    if (this.loader) this.loader.style.opacity = '1';
  }

  render() {
    if (!this.content) {
      this.innerHTML = `
        <ha-card>
          <div class="intercom-container">
            
            <div class="islautopia-loader" id="ig-loader">
              <div class="ig-ring"></div>
              <div class="ig-logo">IG</div>
            </div>

            <div class="video-wrapper">
                <video id="video-player" autoplay playsinline muted></video>
            </div>
            <div class="ui-overlay">
              <div class="status-badge">${getLocalText(this._hass, 'connecting')}</div>
              
              <div class="vol-container">
                <ha-icon icon="mdi:volume-high" id="vol-icon"></ha-icon>
                <input type="range" id="vol-slider" min="0" max="1" step="0.05" value="1">
              </div>

              <div class="controls-bar">
                <button id="intercom-button" class="ctrl-btn intercom-btn" disabled>
                  <ha-icon icon="mdi:microphone-off"></ha-icon>
                </button>
                ${this.config.unlock_entity ? `
                <button id="unlock-button" class="ctrl-btn unlock-btn" disabled>
                  <ha-icon icon="mdi:key"></ha-icon>
                </button>
                ` : ''}
              </div>
            </div>
          </div>
        </ha-card>
      `;

      this.content = this.querySelector('.intercom-container');
      this.videoEl = this.querySelector('#video-player');
      this.intercomButton = this.querySelector('#intercom-button');
      this.intercomIcon = this.querySelector('#intercom-button ha-icon');
      this.badge = this.querySelector('.status-badge');
      this.volSlider = this.querySelector('#vol-slider');
      this.volIcon = this.querySelector('#vol-icon');
      this.loader = this.querySelector('#ig-loader');

      if (this.config.height && this.config.height !== 'auto') {
        this.content.style.height = this.config.height;
        this.content.style.aspectRatio = 'unset';
      } else {
        this.content.style.height = 'auto';
        this.content.style.aspectRatio = '16/9'; 
      }

      if (this.config.unlock_entity) {
        this.unlockButton = this.querySelector('#unlock-button');
        this.unlockIcon = this.querySelector('#unlock-button ha-icon');
        this.unlockButton.addEventListener('click', () => this.triggerUnlock());
      }

      this.intercomButton.addEventListener('click', () => this.toggleIntercom());
      
      const savedVol = localStorage.getItem('islautopia-intercom-vol') || '1';
      this.volSlider.value = savedVol;
      this.volIcon.setAttribute('icon', savedVol === "0" ? 'mdi:volume-off' : 'mdi:volume-high');

      this.volSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        this.videoEl.volume = val;
        this.volIcon.setAttribute('icon', val === "0" ? 'mdi:volume-off' : 'mdi:volume-high');
        localStorage.setItem('islautopia-intercom-vol', val);
      });

      this.injectStyles();
      this.startWebRTC();
    }
  }

  async startWebRTC() {
    if (this.pc) this.pc.close();
    if (this.vlcWS) this.vlcWS.close();

    const isHttps = window.location.protocol === 'https:';
    const wsProtocol = isHttps ? 'wss:' : 'ws:';
    
    const wsUrl = this.mode === 'islautopia_gateway' 
      ? `${wsProtocol}//${window.location.host}/api/ws?src=${this.config.stream}`
      : this.config.go2rtc_url.replace(/^http/, 'ws') + `/api/ws?src=${this.config.stream}`;
    
    this.connectGo2RTCWebSocket(wsUrl);
  }

  async connectGo2RTCWebSocket(wsUrl) {
    try {
      this.vlcWS = new WebSocket(wsUrl);
      this.pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const dest = audioCtx.createMediaStreamDestination();
      this.dummyAudioTrack = dest.stream.getAudioTracks()[0];

      this.videoTransceiver = this.pc.addTransceiver('video', { direction: 'recvonly' });
      this.audioTransceiver = this.pc.addTransceiver(this.dummyAudioTrack, { direction: 'sendrecv' });

      this.pc.ontrack = (event) => this.setupRemoteStream(event.streams[0]);

      this.pc.onicecandidate = (e) => {
        if (e.candidate && this.vlcWS.readyState === WebSocket.OPEN) {
          this.vlcWS.send(JSON.stringify({ type: "webrtc/candidate", value: e.candidate.candidate }));
        }
      };

      this.vlcWS.onmessage = async (msg) => {
        const data = JSON.parse(msg.data);
        if (data.type === 'webrtc/answer') await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.value }));
        else if (data.type === 'webrtc/candidate') await this.pc.addIceCandidate(new RTCIceCandidate({ candidate: data.value, sdpMid: '0', sdpMLineIndex: 0 })).catch(() => {});
      };

      this.vlcWS.onopen = async () => {
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        this.vlcWS.send(JSON.stringify({ type: "webrtc/offer", value: offer.sdp }));
      };
    } catch (err) {
      this.badge.textContent = getLocalText(this._hass, 'error_cam');
    }
  }

  async toggleIntercom() {
    this.intercomActive = !this.intercomActive;
    if (this.intercomActive) {
      try {
        this.videoEl.muted = false;
        this.localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const realAudioTrack = this.localAudioStream.getAudioTracks()[0];
        if (this.audioTransceiver && this.audioTransceiver.sender) await this.audioTransceiver.sender.replaceTrack(realAudioTrack);
        
        this.intercomButton.classList.add('active-intercom');
        this.intercomIcon.setAttribute('icon', 'mdi:microphone');
        this.badge.textContent = getLocalText(this._hass, 'open');
      } catch (err) {
        this.intercomActive = false;
        this.videoEl.muted = true;
      }
    } else {
      this.videoEl.muted = true;
      if (this.localAudioStream) {
        this.localAudioStream.getTracks().forEach(track => track.stop());
        this.localAudioStream = null;
      }
      if (this.audioTransceiver && this.audioTransceiver.sender) await this.audioTransceiver.sender.replaceTrack(this.dummyAudioTrack);
      
      this.intercomButton.classList.remove('active-intercom');
      this.intercomIcon.setAttribute('icon', 'mdi:microphone-off');
      this.badge.textContent = getLocalText(this._hass, 'live');
    }
  }

  setupRemoteStream(stream) {
    if (this.videoEl.srcObject !== stream) {
      this.videoEl.srcObject = stream;
      this.videoEl.muted = true; 
      this.videoEl.volume = parseFloat(this.volSlider.value);
      this.videoEl.play().catch(() => {});
      
      this.badge.textContent = getLocalText(this._hass, 'live');
      this.intercomButton.removeAttribute('disabled');
      if (this.unlockButton) this.unlockButton.removeAttribute('disabled');
      
      if (this.loader) {
        this.loader.style.opacity = '0';
        setTimeout(() => this.loader.style.pointerEvents = 'none', 300);
      }
    }
  }

  triggerUnlock() {
    if (!this._hass || !this.config.unlock_entity) return;
    const entityId = this.config.unlock_entity;
    const domain = entityId.split('.')[0];
    
    let duration = parseInt(this.config.unlock_duration) || 3;
    let service = domain === 'button' ? 'press' : (domain === 'lock' ? 'unlock' : 'turn_on');

    this._hass.callService(domain, service, { entity_id: entityId });
    this.unlockButton.classList.add('active-unlock');
    this.unlockIcon.setAttribute('icon', 'mdi:door-open');
    
    setTimeout(() => {
      this.unlockButton.classList.remove('active-unlock');
      this.unlockIcon.setAttribute('icon', 'mdi:key');
      if (domain === 'switch' || domain === 'light') {
        this._hass.callService(domain, 'turn_off', { entity_id: entityId });
      }
    }, duration * 1000);
  }

  injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      ha-card { overflow: hidden; border-radius: var(--ha-card-border-radius, 12px); box-shadow: var(--ha-card-box-shadow, 0px 2px 4px -1px rgba(0,0,0,0.2)); background: #000; }
      .intercom-container { position: relative; width: 100%; background: #111; }
      .video-wrapper { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
      .video-wrapper video { width: 100%; height: 100%; object-fit: contain; }
      
      .islautopia-loader { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: #111; z-index: 10; display: flex; align-items: center; justify-content: center; transition: opacity 0.3s ease; }
      .ig-ring { position: absolute; width: 60px; height: 60px; border: 4px solid rgba(3, 169, 244, 0.2); border-top-color: #03a9f4; border-radius: 50%; animation: ig-spin 1s linear infinite; }
      .ig-logo { position: absolute; color: #fff; font-family: system-ui, sans-serif; font-weight: 800; font-size: 16px; letter-spacing: 1px; }
      @keyframes ig-spin { 100% { transform: rotate(360deg); } }

      .ui-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; display: flex; flex-direction: column; justify-content: space-between; padding: 16px; box-sizing: border-box; z-index: 20;}
      .status-badge { background: rgba(0, 0, 0, 0.6); color: white; padding: 4px 12px; border-radius: 16px; font-size: 12px; font-family: sans-serif; align-self: flex-start; backdrop-filter: blur(4px); transition: all 0.3s ease; }
      .controls-bar { position: relative; display: flex; justify-content: center; align-items: center; width: 100%; margin-bottom: 8px; pointer-events: none; }
      
      .vol-container { position: absolute; left: 0; bottom: 0; display: flex; align-items: center; gap: 8px; background: rgba(0,0,0,0.6); padding: 6px 12px; border-radius: 20px; color: white; pointer-events: auto; backdrop-filter: blur(4px); }
      .vol-container input[type=range] { width: 80px; accent-color: var(--primary-color, #03a9f4); cursor: pointer; }
      .vol-container ha-icon { --mdc-icon-size: 20px; }

      .ctrl-btn { width: 64px; height: 64px; border-radius: 50%; border: none; background: rgba(255, 255, 255, 0.9); color: #333; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.3); transition: all 0.3s ease; display: flex; align-items: center; justify-content: center; pointer-events: auto; }
      .ctrl-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .ctrl-btn ha-icon { --mdc-icon-size: 32px; }
      .unlock-btn { position: absolute; right: 0; }
      .active-intercom { background: #ff4a4a; color: white; box-shadow: 0 0 20px rgba(255, 74, 74, 0.6); transform: scale(1.1); }
      .active-unlock { background: #4caf50; color: white; box-shadow: 0 0 20px rgba(76, 175, 80, 0.6); transform: scale(1.1); }
    `;
    this.appendChild(style);
  }
}

// ==============================================================================
// EDITOR VISUAL TRADUCIDO (A prueba de condiciones de carrera)
// ==============================================================================
class IslautopiaIntercomCardEditor extends HTMLElement {
  set hass(hass) { 
    this._hass = hass;
    this.render(); // Dejamos que render() decida si tiene todo lo necesario
  }

  setConfig(config) {
    this._config = Object.assign({}, config);
    this.render(); // Dejamos que render() decida si tiene todo lo necesario
  }

  render() {
    // 🚀 EL FIX: Solo pintamos si tenemos config, hass, y no hemos pintado ya.
    if (!this._config || !this._hass || this._rendered) return;
    
    this.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 16px; padding: 8px 0;">
        <div style="display: flex; flex-direction: column;">
          <label style="font-size: 14px; margin-bottom: 4px; color: var(--primary-text-color);">${getLocalText(this._hass, 'ed_stream')}</label>
          <input type="text" id="stream" value="${this._config.stream || ''}" style="padding: 10px; border: 1px solid var(--divider-color, #ccc); border-radius: 4px; background: var(--card-background-color, #fff); color: var(--primary-text-color);">
        </div>
        <div style="display: flex; flex-direction: column;">
          <label style="font-size: 14px; margin-bottom: 4px; color: var(--primary-text-color);">${getLocalText(this._hass, 'ed_url')}</label>
          <input type="text" id="go2rtc_url" value="${this._config.go2rtc_url || ''}" style="padding: 10px; border: 1px solid var(--divider-color, #ccc); border-radius: 4px; background: var(--card-background-color, #fff); color: var(--primary-text-color);">
        </div>
        <div style="display: flex; flex-direction: column;">
          <label style="font-size: 14px; margin-bottom: 4px; color: var(--primary-text-color);">${getLocalText(this._hass, 'ed_entity')}</label>
          <input type="text" id="unlock_entity" value="${this._config.unlock_entity || ''}" style="padding: 10px; border: 1px solid var(--divider-color, #ccc); border-radius: 4px; background: var(--card-background-color, #fff); color: var(--primary-text-color);">
        </div>
        <div style="display: flex; flex-direction: column;">
          <label style="font-size: 14px; margin-bottom: 4px; color: var(--primary-text-color);">${getLocalText(this._hass, 'ed_duration')}</label>
          <input type="number" id="unlock_duration" min="1" max="20" value="${this._config.unlock_duration || 3}" style="padding: 10px; border: 1px solid var(--divider-color, #ccc); border-radius: 4px; background: var(--card-background-color, #fff); color: var(--primary-text-color);">
        </div>
        <div style="display: flex; flex-direction: column;">
          <label style="font-size: 14px; margin-bottom: 4px; color: var(--primary-text-color);">${getLocalText(this._hass, 'ed_height')}</label>
          <input type="text" id="height" value="${this._config.height || 'auto'}" style="padding: 10px; border: 1px solid var(--divider-color, #ccc); border-radius: 4px; background: var(--card-background-color, #fff); color: var(--primary-text-color);">
        </div>
      </div>
    `;

    const inputs = this.querySelectorAll('input');
    inputs.forEach(input => {
      input.addEventListener('input', (e) => {
        if (!this._config) return;
        const newConfig = Object.assign({}, this._config);
        if (e.target.value === '') delete newConfig[e.target.id];
        else newConfig[e.target.id] = e.target.value;

        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: newConfig }, bubbles: true, composed: true }));
      });
    });

    // Marcamos como dibujado SOLAMENTE cuando hemos puesto los inputs en pantalla
    this._rendered = true;
  }
}

customElements.define('islautopia-intercom-card-editor', IslautopiaIntercomCardEditor);
customElements.define('islautopia-intercom-card', IslautopiaIntercomCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "islautopia-intercom-card",
  name: "Islautopia Intercom",
  preview: true,
  description: "Tarjeta de videoportero WebRTC bidireccional optimizada para el ecosistema Islautopia Garage."
});