/* A-836: голос, видео, демонстрация экрана и общий просмотр.
 *
 * Отдельный файл намеренно: раньше всё лежало в index.html, который
 * и так 230 КБ эталона. Модуль ничего не знает про оформление Aurora —
 * он только говорит по WebRTC.
 *
 * Сигналинг — свой, на локальном сервере клиента (/api/rtc/*).
 * Панель Aurora медиа-маршрутов не имеет (проверено по её исходнику),
 * поэтому обмен offer/answer/ICE живёт здесь.
 *
 * Честно о границах:
 *   - два клиента за одним NAT соединяются (сервер у них один);
 *   - клиент на другой машине соединится, только если его локальный
 *     сервер доступен извне — это НЕ сделано и не выдаётся за сделанное;
 *   - ICE-кандидаты отдаются без STUN/TURN, поэтому за симметричным
 *     NAT соединение может не установиться. Причина будет показана.
 */
(function () {
  'use strict';

  var RTC = {
    room: '',
    self: '',
    peers: {},          /* id -> {id, name, pc, stream} */
    micStream: null,
    camStream: null,
    screenStream: null,
    pollBusy: false,
    lastError: '',
    onchange: null
  };
  window.AURORA_RTC = RTC;

  function say(msg) {
    RTC.lastError = msg || '';
    if (typeof RTC.onchange === 'function') RTC.onchange();
  }

  function api(path, body) {
    return fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json(); });
  }

  /* ---------- ICE: локальные кандидаты. Без STUN/TURN это работает
     только внутри одной сети — об этом говорим честно. ---------- */
  var ICE = { iceServers: [] };

  function mediaErrorName(e) {
    if (!e) return 'неизвестная причина';
    if (e.name === 'NotAllowedError') return 'вы не дали доступ к устройству';
    if (e.name === 'NotFoundError') return 'устройство не найдено';
    if (e.name === 'NotReadableError') return 'устройство занято другой программой';
    if (e.name === 'NotSupportedError') return 'браузер не умеет это устройство';
    if (e.name === 'OverconstrainedError') return 'устройство не подошло по требованиям';
    return e.name + ': ' + (e.message || '');
  }

  /* ---------- вход в комнату ---------- */
  function join(room, name) {
    return api('/api/rtc/join', { room: room || 'main', name: name || '' })
      .then(function (r) {
        if (!r || !r.ok) { say('не удалось войти: ' + ((r && r.error) || 'панель молчит')); return false; }
        RTC.room = room || 'main';
        RTC.self = r.id;
        (r.peers || []).forEach(function (p) { RTC.peers[p.id] = { id: p.id, name: p.name, pc: null, stream: null }; });
        say('');
        poll();
        return true;
      })
      .catch(function (e) { say('связь с локальным сервером: ' + e.message); return false; });
  }

  function leave() {
    if (!RTC.self) return Promise.resolve();
    var id = RTC.self;
    Object.keys(RTC.peers).forEach(function (k) { try { RTC.peers[k].pc.close(); } catch (e) { /* уже закрыт */ } });
    RTC.peers = {};
    stopAll();
    return api('/api/rtc/leave', { id: id }).catch(function () { return null; });
  }

  /* ---------- создание соединения к пиру ---------- */
  function makePc(peerId) {
    var pc = new RTCPeerConnection(ICE);
    if (RTC.micStream) {
      var mic = RTC.micStream.getAudioTracks()[0];
      if (mic) pc.addTrack(mic, RTC.micStream);
    }
    if (RTC.camStream) {
      var cam = RTC.camStream.getVideoTracks()[0];
      if (cam) pc.addTrack(cam, RTC.camStream);
    }
    if (RTC.screenStream) {
      var st = RTC.screenStream.getVideoTracks()[0];
      if (st) pc.addTrack(st, RTC.screenStream);
    }
    pc.onicecandidate = function (ev) {
      if (ev.candidate) {
        api('/api/rtc/signal', { from: RTC.self, to: peerId, type: 'ice', payload: JSON.stringify(ev.candidate) });
      }
    };
    pc.ontrack = function (ev) {
      var p = RTC.peers[peerId];
      if (!p) return;
      p.stream = ev.streams[0] || new MediaStream([ev.track]);
      if (typeof RTC.onchange === 'function') RTC.onchange();
    };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        if (RTC.peers[peerId]) delete RTC.peers[peerId];
        if (typeof RTC.onchange === 'function') RTC.onchange();
      }
    };
    return pc;
  }

  function sendSignal(to, type, payload) {
    return api('/api/rtc/signal', { from: RTC.self, to: to, type: type, payload: payload });
  }

  /* Мы присоединяемся к уже сидящим: сразу offer. */
  function callPeer(peerId) {
    var p = RTC.peers[peerId];
    if (!p) return;
    p.pc = makePc(peerId);
    p.pc.createOffer()
      .then(function (off) { return p.pc.setLocalDescription(off); })
      .then(function () { return sendSignal(peerId, 'offer', JSON.stringify(p.pc.localDescription)); })
      .catch(function (e) { say('не удалось позвать пира: ' + e.message); });
  }

  function onSignal(m) {
    var peerId = m.from;
    if (m.type === 'bye') {
      if (RTC.peers[peerId]) {
        try { RTC.peers[peerId].pc.close(); } catch (e) { /* уже закрыт */ }
        delete RTC.peers[peerId];
      }
      if (typeof RTC.onchange === 'function') RTC.onchange();
      return;
    }
    if (m.type === 'state') {
      var st = {};
      try { st = JSON.parse(m.payload || '{}'); } catch (e) { st = {}; }
      if (RTC.peers[peerId]) { RTC.peers[peerId].video = st.video; RTC.peers[peerId].sharing = st.sharing; }
      if (typeof RTC.onchange === 'function') RTC.onchange();
      return;
    }
    var p = RTC.peers[peerId];
    if (!p) return;
    if (m.type === 'offer') {
      if (!p.pc) p.pc = makePc(peerId);
      p.pc.setRemoteDescription(JSON.parse(m.payload))
        .then(function () { return p.pc.createAnswer(); })
        .then(function (ans) { return p.pc.setLocalDescription(ans); })
        .then(function () { return sendSignal(peerId, 'answer', JSON.stringify(p.pc.localDescription)); })
        .catch(function (e) { say('не удалось ответить пиру: ' + e.message); });
    } else if (m.type === 'answer') {
      if (p.pc) p.pc.setRemoteDescription(JSON.parse(m.payload)).catch(function () { /* поздно */ });
    } else if (m.type === 'ice') {
      if (p.pc) p.pc.addIceCandidate(JSON.parse(m.payload)).catch(function () { /* кандидат устарел */ });
    }
  }

  /* Долгий опрос: одного HTTP хватает на весь разговор. */
  function poll() {
    if (RTC.pollBusy || !RTC.self) return;
    RTC.pollBusy = true;
    api('/api/rtc/poll?id=' + encodeURIComponent(RTC.self) + '&wait=20000')
      .then(function (r) {
        if (r && r.ok) (r.messages || []).forEach(onSignal);
      })
      .catch(function () { /* локальный сервер перезапускается — следующий опрос */ })
      .then(function () { RTC.pollBusy = false; setTimeout(poll, 400); });
  }

  /* ---------- устройства ---------- */
  function startMic() {
    return navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function (s) {
        if (RTC.micStream) stopTrack(RTC.micStream);
        RTC.micStream = s;
        rebroadcast();
        say('');
        return true;
      })
      .catch(function (e) { say('микрофон: ' + mediaErrorName(e)); return false; });
  }

  function startCam() {
    return navigator.mediaDevices.getUserMedia({ video: true })
      .then(function (s) {
        if (RTC.camStream) stopTrack(RTC.camStream);
        RTC.camStream = s;
        rebroadcast();
        say('');
        return true;
      })
      .catch(function (e) { say('камера: ' + mediaErrorName(e)); return false; });
  }

  /* Демонстрация экрана: настоящий getDisplayMedia. */
  function startScreen() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      say('этот браузер не умеет показывать экран');
      return Promise.resolve(false);
    }
    return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      .then(function (s) {
        stopTrack(RTC.screenStream);
        RTC.screenStream = s;
        /* Пользователь может остановить демонстрацию через панель браузера. */
        var v = s.getVideoTracks()[0];
        if (v && v.addEventListener) {
          v.addEventListener('ended', function () {
            RTC.screenStream = null;
            rebroadcast();
            if (typeof RTC.onchange === 'function') RTC.onchange();
          });
        }
        rebroadcast();
        say('');
        return true;
      })
      .catch(function (e) { say('экран: ' + mediaErrorName(e)); return false; });
  }

  function stopScreen() {
    stopTrack(RTC.screenStream);
    RTC.screenStream = null;
    rebroadcast();
  }

  function stopAll() {
    stopTrack(RTC.micStream); RTC.micStream = null;
    stopTrack(RTC.camStream); RTC.camStream = null;
    stopTrack(RTC.screenStream); RTC.screenStream = null;
    rebroadcast();
  }

  function stopTrack(stream) {
    if (!stream) return;
    stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* уже остановлен */ } });
  }

  /* Новые дорожки надо добавить во ВСЕ открытые соединения. */
  function rebroadcast() {
    Object.keys(RTC.peers).forEach(function (id) {
      var pc = RTC.peers[id].pc;
      if (!pc) return;
      var have = pc.getSenders().map(function (x) { return x.track; });
      if (RTC.micStream) {
        var a = RTC.micStream.getAudioTracks()[0];
        if (a && a.kind === 'audio' && have.indexOf(a) < 0) pc.addTrack(a, RTC.micStream);
      }
      if (RTC.camStream) {
        var v = RTC.camStream.getVideoTracks()[0];
        if (v && v.kind === 'video' && have.indexOf(v) < 0) pc.addTrack(v, RTC.camStream);
      }
      if (RTC.screenStream) {
        var sc = RTC.screenStream.getVideoTracks()[0];
        if (sc && sc.kind === 'video' && have.indexOf(sc) < 0) pc.addTrack(sc, RTC.screenStream);
      }
      /* Обратно: дорожка отключена на нашей стороне — убираем у пира. */
      var want = []
        .concat(RTC.micStream ? RTC.micStream.getAudioTracks() : [])
        .concat(RTC.camStream ? RTC.camStream.getVideoTracks() : [])
        .concat(RTC.screenStream ? RTC.screenStream.getVideoTracks() : []);
      pc.getSenders().forEach(function (snd) {
        if (snd.track && want.indexOf(snd.track) < 0) { try { pc.removeTrack(snd); } catch (e) { /* нет */ } }
      });
      api('/api/rtc/state', { id: RTC.self, video: !!(RTC.camStream || RTC.screenStream), sharing: !!RTC.screenStream });
    });
  }

  function setMute(on) {
    if (!RTC.micStream) return Promise.resolve(false);
    RTC.micStream.getAudioTracks().forEach(function (t) { t.enabled = !on; });
    return Promise.resolve(true);
  }

  function toggleScreenTrack(on) {
    if (!RTC.camStream) return false;
    RTC.camStream.getVideoTracks().forEach(function (t) { t.enabled = on !== false; });
    return true;
  }

  function peerList() {
    return Object.keys(RTC.peers).map(function (k) { return RTC.peers[k]; });
  }

  window.AURORA_RTC_JOIN = join;
  window.AURORA_RTC_LEAVE = leave;
  window.AURORA_RTC_CALL = callPeer;
  window.AURORA_RTC_MIC = startMic;
  window.AURORA_RTC_CAM = startCam;
  window.AURORA_RTC_SCREEN = startScreen;
  window.AURORA_RTC_SCREEN_STOP = stopScreen;
  window.AURORA_RTC_STOP = stopAll;
  window.AURORA_RTC_MUTE = setMute;
  window.AURORA_RTC_CAMTOGGLE = toggleScreenTrack;
  window.AURORA_RTC_PEERS = peerList;
  window.AURORA_RTC_STATE = RTC;
}());
