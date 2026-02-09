"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  send: (channel, data) => {
    const validChannels = ["update-output", "update-stage"];
    if (validChannels.includes(channel)) {
      electron.ipcRenderer.send(channel, data);
    }
  },
  on: (channel, func) => {
    const validChannels = ["update-output", "update-stage"];
    if (validChannels.includes(channel)) {
      const subscription = (_event, ...args) => func(...args);
      electron.ipcRenderer.on(channel, subscription);
      return () => {
        electron.ipcRenderer.removeListener(channel, subscription);
      };
    }
    return () => {
    };
  },
  off: (channel, func) => {
    electron.ipcRenderer.removeListener(channel, func);
  },
  selectMediaFiles: async () => {
    return electron.ipcRenderer.invoke("dialog:openFile");
  },
  saveProject: async (data) => {
    return electron.ipcRenderer.invoke("save-project", data);
  },
  loadProject: async () => {
    return electron.ipcRenderer.invoke("load-project");
  },
  // Library & Playlist API
  getLibrary: async () => electron.ipcRenderer.invoke("get-library"),
  saveToLibrary: async (presentation) => electron.ipcRenderer.invoke("save-to-library", presentation),
  deleteFromLibrary: async (id) => electron.ipcRenderer.invoke("delete-from-library", id),
  getPlaylist: async () => electron.ipcRenderer.invoke("get-playlist"),
  savePlaylist: async (playlist) => electron.ipcRenderer.invoke("save-playlist", playlist),
  // Stage API
  invoke: (channel, ...args) => electron.ipcRenderer.invoke(channel, ...args),
  // Genuine invoke access or explicit method
  // Explicit is safer usually but user pattern used invoke directly in store.ts: window.ipcRenderer.invoke('toggle-stage')
  // Wait, let's check store.ts usage.
  // store.ts used: result = await window.ipcRenderer.invoke('toggle-stage')
  // But currently exposeInMainWorld does NOT expose a raw 'invoke' method. It exposes specific methods.
  // So store.ts is calling a non-existent method on window.ipcRenderer!
  // We should fix typescript definition likely too.
  // Let's add specific method or expose invoke generically (less safe).
  // Given the previous pattern, let's add specific method AND update type definition if needed.
  toggleStage: async () => electron.ipcRenderer.invoke("toggle-stage")
});
