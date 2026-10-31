/**
 * A-852: preload для Aurora Game.
 *
 * Мост из интерфейса в главный процесс. Никаких прямых доступов к
 * Node в странице нет (contextIsolation включён, nodeIntegration выключен) —
 * страница может звать только явно перечисленные операции.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aurora', {
  /** Порт локального сервера (для отладки и диагностики). */
  localPort: () => ipcRenderer.invoke('aurora:local-port'),
  /** Прочитать состояние автозапуска клиента в Windows. */
  getLaunchAtLogin: () => ipcRenderer.invoke('aurora:get-launch-at-login'),
  /** Включить или выключить запуск клиента при входе в Windows. */
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke('aurora:set-launch-at-login', enabled === true),
  /** Сохранить адрес панели и ключи. */
  saveConfig: (patch) => ipcRenderer.invoke('aurora:save-config', patch),
  /** Прочитать настройки без секретов. */
  getConfig: () => ipcRenderer.invoke('aurora:get-config'),
  /** Найти панель Aurora в локальном IPv4 сегменте без передачи ключей. */
  discoverPanel: () => ipcRenderer.invoke('aurora:discover-panel'),
  /** Передать Steam только проверенный адрес сервера и порт. */
  joinSteamServer: (host, port) => ipcRenderer.invoke('aurora:join-steam-server', { host, port }),
  /** Проверить только возможность установить TCP-соединение с адресом. */
  checkDirectServer: (host, port) => ipcRenderer.invoke('aurora:check-direct-server', { host, port }),
  /** Экспортировать только локальную адресную книгу через системный диалог. */
  exportDirectServers: (rows) => ipcRenderer.invoke('aurora:export-direct-servers', rows),
  /** Экспортировать локальные заметки в резервный JSON-файл. */
  exportLocalNotes: (rows) => ipcRenderer.invoke('aurora:export-local-notes', rows),
  /** Прочитать и проверить резервную копию локальных заметок. */
  importLocalNotes: () => ipcRenderer.invoke('aurora:import-local-notes'),
  /** Ключ игрового профиля шифруется DPAPI/safeStorage в основном процессе. */
  getCommunityToken: (origin) => ipcRenderer.invoke('aurora:get-community-token', origin),
  setCommunityToken: (token, origin) => ipcRenderer.invoke('aurora:set-community-token', token, origin),
  clearCommunityToken: (origin) => ipcRenderer.invoke('aurora:clear-community-token', origin),
  /** Экспортировать/импортировать ключ игрового профиля через системный выбор файла. */
  exportCommunityIdentity: (token, name) => ipcRenderer.invoke('aurora:export-community-identity', { token, name }),
  importCommunityIdentity: () => ipcRenderer.invoke('aurora:import-community-identity'),
  /** Управление окном. */
  window: (action) => ipcRenderer.send('aurora:window', action),
});
