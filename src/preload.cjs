const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('skilldock', {
  call: async (method, input) => {
    const result = await ipcRenderer.invoke('skilldock', method, input);
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }
});
