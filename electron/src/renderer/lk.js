/* A-838: медиа через LiveKit SFU — та же механика, что в Revolt.
 *
 * Почему LiveKit, а не свой сигналинг: владелец показал на Revolt
 * (github.com/revoltchat) и попросил взять готовые механики. Revolt
 * работает через LiveKit: комната, в неё заходят участники, каждый
 * публикует микрофон/камеру/экран, SFU сам решает, кому что слать.
 * Свой сигналинг (rtc.js) остаётся запасным: если сервер LiveKit не
 * запущен, приложение скажет об этом прямо, а не будет молчать.
 *
 * Для локальной комнаты токен подписывает Electron main process, а ключ
 * создаётся отдельно в профиле Windows. Для общедоступного игрового
 * канала renderer передаёт grant от `/game/media-token`: его подписывает
 * игровой сервер, а LiveKit secret клиенту не выдаётся.
 */
(function () {
  'use strict';

  var LK = {
    room: null,          // экземпляр Room
    roomName: 'igra',
    identity: '',
    community: false,
    myId: '',
    joined: false,
    speaking: false,
    error: '',
    status: 'не подключено',
    mic: null,           // MediaStreamTrack
    cam: null,
    screen: null,
    deafened: false,     // весь входящий звук выключен
    remote: {},          // id -> {audio: MediaStream, video: MediaStream, info: {}}
    tokenUrl: '/api/media/token',
    serverUrl: 'ws://127.0.0.1:7880',
  };

  function say(msg, bad) {
    LK.error = bad ? msg : '';
    if (typeof window.renderLiveKit === 'function') window.renderLiveKit();
  }

  /* Запасной путь для локальной комнаты; community voice передаёт grant. */
  function askToken(roomName, identity) {
    return fetch(LK.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: roomName, identity: identity })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || j.ok !== true) throw new Error((j && j.error) || 'сервер не выдал токен');
      return j;
    });
  }

  function serverState() {
    return fetch('/api/media/server').then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, running: false }; });
  }

  /* A-876: участник, который был в комнате ДО нас, не вызывает
     ParticipantConnected — это событие приходит только тем, кто подключился
     позже. Из-за этого вошедший вторым видел пустой список: первый участник
     был в его комнате, но в LK.remote не попадал.
     Проверено фактом: Room.remoteParticipants.size = 1, а peers() = 0.
     Поэтому после входа перебираем тех, кто уже в комнате, и подписываем
     их треки так же, как у вновь пришедших. */
  function registerParticipant(p) {
    var id = p.identity || p.id;
    if (!id) return null;
    if (!LK.remote[id]) {
      LK.remote[id] = { audio: null, video: null, speaking: !!p.isSpeaking,
        info: { name: p.name || id } };
    }
    return LK.remote[id];
  }

  function attachTrack(track, participant, publication) {
    var slot = registerParticipant(participant);
    if (!slot) return;
    if (track.kind === 'audio') {
      if (slot.audio) { try { slot.audio.detach(); } catch (e) { /* старый трек уже закрыт */ } }
      try { slot.audio = new window.LivekitClient.RemoteAudioTrack(track); } catch (e) { return; }
      slot.audioRaw = track;
      slot.audioEl = slot.audio.attach();
      /* A-940: если звук выключен, новые дорожки приходят уже приглушёнными. */
      if (slot.audioEl) slot.audioEl.muted = !!LK.deafened;
    } else if (track.kind === 'video') {
      if (slot.video) { try { slot.video.detach(); } catch (e) { /* предыдущая камера уже закрыта */ } }
      slot.video = new window.LivekitClient.RemoteVideoTrack(track);
      slot.videoRaw = track;
      slot.videoSource = publication && publication.source || '';
    }
  }

  /* Подхватить всех, кто уже сидит в комнате к моменту нашего входа. */
  function adoptExisting() {
    if (!LK.room || !LK.room.remoteParticipants) return;
    LK.room.remoteParticipants.forEach(function (p) {
      registerParticipant(p);
      var pubs = p.trackPublications || p.publications || {};
      Object.keys(pubs).forEach(function (k) {
        var tr = (pubs[k] || {}).track;
        if (tr) attachTrack(tr, p, pubs[k]);
      });
    });
  }

  /* ---------- комната ---------- */
  function connect(roomName, identity, mediaGrant) {
    if (LK.joined) return Promise.resolve(LK);
    LK.community = !!mediaGrant;
    LK.roomName = roomName || 'igra';
    LK.identity = identity || ('guest-' + Math.random().toString(36).slice(2, 8));
    LK.status = 'подключение…';
    if (typeof window.renderLiveKit === 'function') window.renderLiveKit();

    var tokenPromise;
    if (mediaGrant) {
      var mediaUrl;
      try { mediaUrl = new URL(String(mediaGrant.server_url || '')); }
      catch (e) { mediaUrl = null; }
      if (!mediaUrl || mediaUrl.protocol !== 'wss:' || mediaUrl.username || mediaUrl.password ||
          !mediaGrant.token || String(mediaGrant.room || '') !== LK.roomName ||
          String(mediaGrant.identity || '') !== LK.identity) {
        tokenPromise = Promise.reject(new Error('игровой сервер выдал некорректный медиатокен'));
      } else {
        tokenPromise = Promise.resolve(mediaGrant);
      }
    } else {
      tokenPromise = serverState().then(function (s) {
        if (!s || s.running !== true) {
          LK.status = 'медиасервер не запущен';
          say('Локальный LiveKit не запущен. Для внешнего голосового канала нужен настроенный медиасервер.', true);
          throw new Error('livekit не запущен');
        }
        return askToken(LK.roomName, LK.identity);
      });
    }
    return tokenPromise.then(function (t) {
      if (typeof window.LivekitClient === 'undefined') throw new Error('SDK LiveKit не загружен');
      LK.serverUrl = t.server_url || t.url || LK.serverUrl;
      LK.room = new window.LivekitClient.Room({
        adaptiveStream: true,
        dynacast: true,
      });

      /* Участник вошёл или вышел — держим список живым. */
      LK.room.on(window.LivekitClient.RoomEvent.ParticipantConnected, function (p) {
        registerParticipant(p);
        paint();
      });
      LK.room.on(window.LivekitClient.RoomEvent.ParticipantDisconnected, function (p) {
        var slot = LK.remote[p.identity];
        if (slot && slot.audio) { try { slot.audio.detach(); } catch (e) { /* поток закрывается */ } }
        if (slot && slot.video) { try { slot.video.detach(); } catch (e) { /* поток закрывается */ } }
        delete LK.remote[p.identity];
        paint();
      });

      /* LiveKit публикует фактических активных говорящих; наличие микрофонной
         дорожки само по себе не означает, что участник сейчас говорит. */
      if (window.LivekitClient.RoomEvent.ActiveSpeakersChanged) {
        LK.room.on(window.LivekitClient.RoomEvent.ActiveSpeakersChanged, function (participants) {
          var active = Object.create(null);
          (participants || []).forEach(function (p) {
            var id = p && (p.identity || p.id);
            if (id) active[id] = true;
          });
          var localSpeaking = !!active[LK.identity];
          var changed = LK.speaking !== localSpeaking;
          LK.speaking = localSpeaking;
          Object.keys(LK.remote).forEach(function (id) {
            var speaking = !!active[id];
            if (LK.remote[id].speaking !== speaking) {
              LK.remote[id].speaking = speaking;
              changed = true;
            }
          });
          if (changed) paint();
        });
      }

      /* Голос участника. */
      LK.room.on(window.LivekitClient.RoomEvent.TrackSubscribed, function (track, pub, participant) {
        attachTrack(track, participant, pub);
        paint();
      });

      /* Участник опубликовал экран — это и есть «общий просмотр»: его поток
         показываем у себя отдельным окном. */
      LK.room.on(window.LivekitClient.RoomEvent.TrackUnsubscribed, function (track, pub, participant) {
        var slot = LK.remote[participant.identity];
        if (!slot) return;
        if (track.kind === 'audio' && slot.audio && slot.audioRaw === track) {
          try { slot.audio.detach(); } catch (e) { /* audio element уже закрыт */ }
          slot.audio = null;
          slot.audioEl = null;
          slot.audioRaw = null;
        } else if (track.kind === 'video' && slot.video && slot.videoRaw === track) {
          try { slot.video.detach(); } catch (e) { /* элемент уже удалён */ }
          slot.video = null;
          slot.videoRaw = null;
          slot.videoSource = '';
        }
        paint();
      });

      /* Данные: файлы, гифки, стикеры от других участников. */
      LK.room.on(window.LivekitClient.RoomEvent.DataReceived, function (payload, participant) {
        var text = '';
        try { text = new TextDecoder().decode(payload); } catch (e) { return; }
        var obj = null;
        try { obj = JSON.parse(text); } catch (e) { return; }
        onData(obj, participant);
      });

      return LK.room.connect(LK.serverUrl, t.token);
    }).then(function () {
      LK.joined = true;
      LK.status = 'в комнате';
      /* A-876: подхватываем тех, кто был в комнате до нас. */
      adoptExisting();
      say('');
      paint();
    }).catch(function (e) {
      LK.status = 'не подключено';
      LK.community = false;
      say((e && e.message) || 'подключение не удалось', true);
      paint();
      throw e;
    });
  }

  /* Публичные игровые комнаты могут использовать другой SFU, комнату и
     identity, чем локальные сценарии. Переключаем весь LiveKit-сеанс явно. */
  function connectCommunity(mediaGrant) {
    var sameSession = LK.joined && LK.community &&
      LK.roomName === String(mediaGrant && mediaGrant.room || '') &&
      LK.identity === String(mediaGrant && mediaGrant.identity || '') &&
      LK.serverUrl === String(mediaGrant && mediaGrant.server_url || '');
    if (sameSession) return Promise.resolve(LK);
    var leaveCurrent = LK.joined ? leave() : Promise.resolve();
    return Promise.resolve(leaveCurrent).then(function () {
      return connect(mediaGrant && mediaGrant.room, mediaGrant && mediaGrant.identity, mediaGrant);
    });
  }

  function leave() {
    if (LK.room) { try { LK.room.disconnect(); } catch (e) { /* уже отключён */ } }
    LK.room = null;
    LK.joined = false;
    LK.community = false;
    LK.speaking = false;
    LK.status = 'не подключено';
    stopAll();
    paint();
  }

  /* ---------- микрофон ---------- */
  function setMic(on) {
    if (!LK.joined) return Promise.reject(new Error('сначала войдите в комнату'));
    if (on) {
      if (LK.mic) return Promise.resolve();
      var selectedMic = window.AURORA_MEDIA && window.AURORA_MEDIA.selMic;
      var micConstraints = { audio: selectedMic ? { deviceId: { exact: selectedMic } } : true };
      return navigator.mediaDevices.getUserMedia(micConstraints)
        .then(function (st) {
          LK.mic = st && st.getAudioTracks && st.getAudioTracks()[0];
          if (!LK.mic || LK.mic.kind !== 'audio' || typeof LK.mic.stop !== 'function') {
            if (st && st.getTracks) st.getTracks().forEach(function (track) { try { track.stop(); } catch (e) {} });
            LK.mic = null;
            throw new Error('микрофон не вернул аудиодорожку');
          }
          var track = LK.mic;
          return LK.room.localParticipant.publishTrack(track, { source: window.LivekitClient.Track.Source.Microphone })
            .catch(function (e) {
              if (LK.mic === track) LK.mic = null;
              try { track.stop(); } catch (stopError) { /* захват уже закрыт */ }
              throw e;
            });
        })
        .then(function () { paint(); })
        .catch(function (e) { say(mediaWhy(e), true); throw e; });
    }
    if (LK.mic) LK.room.localParticipant.unpublishTrack(LK.mic);
    if (LK.mic) { LK.mic.stop(); LK.mic = null; }
    paint();
    return Promise.resolve();
  }

  function setMute(muted) {
    if (LK.mic) LK.mic.enabled = !muted;
    if (muted) LK.speaking = false;
    paint();
  }

  /* Глушим весь входящий звук. Дорожки не отписываем: это локальное
     приглушение элемента, публикация остальных участников не страдает. */
  function setDeafened(on) {
    LK.deafened = !!on;
    Object.keys(LK.remote).forEach(function (k) {
      var slot = LK.remote[k];
      if (slot && slot.audioEl) slot.audioEl.muted = LK.deafened;
    });
    paint();
    return Promise.resolve();
  }

  /* ---------- камера ---------- */
  function setCam(on) {
    if (!LK.joined) return Promise.reject(new Error('сначала войдите в комнату'));
    if (on) {
      if (LK.cam) return Promise.resolve();
      var selectedCam = window.AURORA_MEDIA && window.AURORA_MEDIA.selCam;
      var camConstraints = { video: selectedCam ? { deviceId: { exact: selectedCam } } : true };
      return navigator.mediaDevices.getUserMedia(camConstraints)
        .then(function (st) {
          LK.cam = st && st.getVideoTracks && st.getVideoTracks()[0];
          if (!LK.cam || LK.cam.kind !== 'video' || typeof LK.cam.stop !== 'function') {
            if (st && st.getTracks) st.getTracks().forEach(function (track) { try { track.stop(); } catch (e) {} });
            LK.cam = null;
            throw new Error('камера не вернула видеодорожку');
          }
          var track = LK.cam;
          return LK.room.localParticipant.publishTrack(track, { source: window.LivekitClient.Track.Source.Camera })
            .catch(function (e) {
              if (LK.cam === track) LK.cam = null;
              try { track.stop(); } catch (stopError) { /* захват уже закрыт */ }
              throw e;
            });
        })
        .then(function () { paint(); })
        .catch(function (e) { say(mediaWhy(e), true); throw e; });
    }
    if (LK.cam) LK.room.localParticipant.unpublishTrack(LK.cam);
    if (LK.cam) { LK.cam.stop(); LK.cam = null; }
    paint();
    return Promise.resolve();
  }

  /* ---------- демонстрация экрана ---------- */
  function setScreen(on) {
    if (!LK.joined) return Promise.reject(new Error('сначала войдите в комнату'));
    if (on) {
      if (LK.screen) return Promise.resolve();
      return navigator.mediaDevices.getDisplayMedia({ video: true })
        .then(function (st) {
          LK.screen = st && st.getVideoTracks && st.getVideoTracks()[0];
          if (!LK.screen || LK.screen.kind !== 'video' || typeof LK.screen.stop !== 'function') {
            if (st && st.getTracks) st.getTracks().forEach(function (track) { try { track.stop(); } catch (e) {} });
            LK.screen = null;
            throw new Error('захват экрана не вернул видеодорожку');
          }
          var track = LK.screen;
          return LK.room.localParticipant.publishTrack(track, { source: window.LivekitClient.Track.Source.ScreenShare })
            .catch(function (e) {
              if (LK.screen === track) LK.screen = null;
              try { track.stop(); } catch (stopError) { /* захват уже закрыт */ }
              throw e;
            });
        })
        .then(function () {
          /* Пользователь может остановить показ панелью браузера — тогда
             гасим дорожку сами, иначе она «висит» мёртвой. */
          if (LK.screen) {
            LK.screen.addEventListener('ended', function () { setScreen(false); });
          }
          paint();
        })
        .catch(function (e) { say(mediaWhy(e), true); throw e; });
    }
    if (LK.screen) LK.room.localParticipant.unpublishTrack(LK.screen);
    if (LK.screen) { LK.screen.stop(); LK.screen = null; }
    paint();
    return Promise.resolve();
  }

  /* Переключение устройства из панели «Голос и видео» должно заменить
     опубликованную дорожку в LiveKit, иначе камера останется локальной. */
  function republish() {
    if (!LK.joined || !LK.room || !window.AURORA_MEDIA || !window.AURORA_MEDIA.stream) return Promise.resolve(false);
    var source = window.LivekitClient.Track.Source;
    var replacements = [
      { key: 'mic', kind: 'audio', source: source.Microphone },
      { key: 'cam', kind: 'video', source: source.Camera },
    ];
    return replacements.reduce(function (chain, item) {
      return chain.then(function () {
        var tracks = item.kind === 'audio'
          ? window.AURORA_MEDIA.stream.getAudioTracks()
          : window.AURORA_MEDIA.stream.getVideoTracks();
        var next = tracks && tracks[0];
        var previous = LK[item.key];
        if (!next || next === previous) return;
        if (previous) LK.room.localParticipant.unpublishTrack(previous);
        LK[item.key] = null;
        return LK.room.localParticipant.publishTrack(next, { source: item.source }).then(function () {
          LK[item.key] = next;
        }).catch(function (error) {
          say('Не удалось опубликовать выбранное устройство: ' + mediaWhy(error), true);
          throw error;
        });
      });
    }, Promise.resolve()).then(function () { paint(); return true; });
  }

  function stopAll() {
    [LK.mic, LK.cam, LK.screen].forEach(function (t) { if (t) { try { t.stop(); } catch (e) {} } });
    LK.mic = LK.cam = LK.screen = null;
    Object.keys(LK.remote).forEach(function (k) {
      var s = LK.remote[k];
      if (s.audio) { try { s.audio.detach(); } catch (e) {} }
      s.audio = null; s.video = null; s.audioEl = null;
    });
    paint();
  }

  /* Причины отказов устройств — разбор поимённо, а не «что-то пошло не так». */
  function mediaWhy(e) {
    var n = e && e.name;
    if (n === 'NotAllowedError') return 'Вы не дали доступ к устройству — разрешите его в настройках браузера.';
    if (n === 'NotFoundError') return 'Устройство не найдено — микрофон или камера не подключены.';
    if (n === 'NotReadableError') return 'Устройство занято другой программой.';
    if (n === 'NotSupportedError') return 'Браузер не умеет этот режим (часто — камера в http без https).';
    if (n === 'OverconstrainedError') return 'Такая камера или микрофон не подходят.';
    if (n === 'AbortError') return 'Показ экрана был отменён.';
    return (e && e.message) || 'устройство не ответило';
  }

  /* ---------- список участников и экранов ---------- */
  function peers() {
    return Object.keys(LK.remote).map(function (id) {
      var s = LK.remote[id];
      return {
        id: id,
        name: (s.info && s.info.name) || id,
        speaking: !!s.speaking,
        mic: !!s.audio,
        cam: !!s.video && s.videoSource !== window.LivekitClient.Track.Source.ScreenShare,
        screen: !!s.video && s.videoSource === window.LivekitClient.Track.Source.ScreenShare,
      };
    });
  }

  /* Кто сейчас показывает экран: их картинка и есть общий просмотр. */
  function screens() {
    return Object.keys(LK.remote)
      .filter(function (k) {
        return LK.remote[k].video && LK.remote[k].videoSource === window.LivekitClient.Track.Source.ScreenShare;
      })
      .map(function (k) { return { id: k, name: (LK.remote[k].info && LK.remote[k].info.name) || k }; });
  }

  function videos() {
    return Object.keys(LK.remote).filter(function (k) { return !!LK.remote[k].video; })
      .map(function (k) {
        var slot = LK.remote[k];
        return { id: k, name: (slot.info && slot.info.name) || k,
          screen: slot.videoSource === window.LivekitClient.Track.Source.ScreenShare };
      });
  }

  function attachVideos(root) {
    if (!root) return;
    Object.keys(LK.remote).forEach(function (id) {
      var slot = LK.remote[id];
      if (!slot.video) return;
      var el = Array.prototype.find.call(root.querySelectorAll('[data-lk-peer]'), function (node) {
        return node.getAttribute('data-lk-peer') === id;
      });
      if (!el) return;
      try { slot.video.attach(el); } catch (e) { /* следующая отрисовка попробует снова */ }
    });
  }

  function attachSelfVideo(root) {
    var track = LK.screen || LK.cam;
    if (!root || !track) return;
    var el = root.querySelector('#lk-self-video');
    if (!el) return;
    try {
      el.srcObject = new MediaStream([track]);
      var playing = el.play();
      if (playing && typeof playing.catch === 'function') playing.catch(function () {});
    } catch (e) { /* предпросмотр повторится при следующей отрисовке */ }
  }

  /* ---------- передача данных: файлы, гифки, стикеры ----------
     Через data-канал LiveKit: это настоящая доставка другому клиенту в
     комнате, а не имитация. Панель Aurora в этом не участвует — медиа
     идёт мимо неё, через медиасервер.
     Файл уходит байтами в data-канале; приём показывается в канале. */
  /* A-877: лимит задан НЕВЕРНО — было 120000, а сервер LiveKit режет
      дата-канал на 64000 байт (проверено фактом: 100 КБ падает с
      "cannot publish data packet larger than 64000 bytes (got 102469)",
      60 КБ проходит). Со старым лимитом пользователь отправлял файл
      65..120 КБ и получал английскую ошибку SDK вместо нашего
      понятного сообщения. Ставим реальную границу с запасом на
      JSON-обёртку (имя файла, base64-раздутие). */
  var MAX_DATA_BYTES = 60000;   // Реальный лимит дата-канала LiveKit — 64000 байт

  function send(payload) {
    if (!LK.joined || !LK.room) {
      say('Сначала войдите в комнату — файлы идут участникам комнаты.', true);
      return Promise.reject(new Error('не в комнате'));
    }
    var body;
    try {
      body = new TextEncoder().encode(JSON.stringify(payload));
    } catch (e) {
      say('Не удалось подготовить данные: ' + (e && e.message), true);
      return Promise.reject(e);
    }
    if (body.length > MAX_DATA_BYTES) {
      say('Файл слишком большой: ' + (body.length / 1024).toFixed(0) +
          ' КБ, можно до ' + (MAX_DATA_BYTES / 1024) + ' КБ.', true);
      return Promise.reject(new Error('слишком большой'));
    }
    return LK.room.localParticipant.publishData(body, { reliable: true })
      .then(function () { paint(); })
      .catch(function (e) { say('Отправка не удалась: ' + (e && e.message), true); throw e; });
  }

  /* Приём от других участников. Файл/гифка/стикер попадают в канал. */
  function onData(payload, participant) {
    if (!payload || !payload.kind) return;
    if (payload.kind === 'watch-state' && typeof window.auroraWatchReceive === 'function') {
      window.auroraWatchReceive(payload, participant);
      return;
    }
    if (payload.kind === 'file' || payload.kind === 'sticker' || payload.kind === 'gif') {
      say('');
      if (typeof window.auroraReceiveFromPeer === 'function') {
        window.auroraReceiveFromPeer(payload, participant);
      }
    }
  }

  /* A-878: maxBytes — это лимит САМОГО пакета, а в канал уходит base64
      внутри JSON. base64 раздувает данные на 4/3, плюс обёртка с именем
      и mime. UI сравнивал с этим лимитом СЫРОЙ размер файла, поэтому
      файл 45 КБ проходил проверку, превращался в ~61 КБ base64 и падал
      уже на сервере. Отдаём отдельно честный лимит для файла. */
  var DATA_OVERHEAD = 512;      // запас на JSON-обёртку (имя, mime, size)
  function maxFileBytes() {
    return Math.floor(((MAX_DATA_BYTES - DATA_OVERHEAD) * 3) / 4);
  }

  function fileInfo() {
    return { joined: LK.joined, maxBytes: MAX_DATA_BYTES, maxFileBytes: maxFileBytes() };
  }

  function paint() {
    if (typeof window.renderLiveKit === 'function') window.renderLiveKit();
    if (typeof window.updateLiveKitSpeakingIndicator === 'function') window.updateLiveKitSpeakingIndicator();
  }

  /* A-843: свой ID хранится, чтобы не вводить его каждый раз. */
  function setMyId(v) {
    LK.myId = String(v || '').slice(0, 40);
    try { localStorage.setItem('aurora_my_id', LK.myId); } catch (e) { /* приватный режим */ }
    paint();
  }
  function loadMyId() {
    try { LK.myId = localStorage.getItem('aurora_my_id') || ''; } catch (e) { LK.myId = ''; }
  }
  loadMyId();

  window.LiveKitMedia = {
    state: LK,
    connect: connect,
    connectCommunity: connectCommunity,
    leave: leave,
    setMic: setMic,
    setMute: setMute,
    setDeafened: setDeafened,
    setCam: setCam,
    setScreen: setScreen,
    stopAll: stopAll,
    peers: peers,
    screens: screens,
    videos: videos,
    attachVideos: attachVideos,
    attachSelfVideo: attachSelfVideo,
    republish: republish,
    send: send,
    fileInfo: fileInfo,
    serverState: serverState,
    mediaWhy: mediaWhy,
  };
})();
