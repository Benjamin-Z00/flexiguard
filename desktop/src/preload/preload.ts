// Preload 脚本：通过 contextBridge 向渲染进程暴露安全 IPC API
// contextIsolation: true + nodeIntegration: false（主进程强制设置）

import { contextBridge, ipcRenderer } from 'electron';

// 暴露给渲染进程的安全 API
const api = {
  // 任务 CRUD
  taskListByDate: (date: string) => ipcRenderer.invoke('task:list-by-date', date),
  taskCreate: (input: {
    title: string;
    planned_start: number;
    planned_end: number;
    planned_minutes: number;
    category?: string;
  }) => ipcRenderer.invoke('task:create', input),
  taskUpdate: (id: string, fields: Record<string, unknown>) =>
    ipcRenderer.invoke('task:update', id, fields),
  taskDelete: (id: string) => ipcRenderer.invoke('task:delete', id),
  // 核验
  verifyTask: (taskId: string) => ipcRenderer.invoke('verify:task', taskId),
  // 日统计
  getDailyStats: (date: string) => ipcRenderer.invoke('daily-stats:get', date),
  // 证据查看
  listEvidence: (taskId: string) => ipcRenderer.invoke('evidence:list-by-task', taskId),
};

contextBridge.exposeInMainWorld('flexiguard', api);

export type FlexiguardApi = typeof api;
