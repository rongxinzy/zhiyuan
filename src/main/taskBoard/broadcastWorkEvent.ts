import { BrowserWindow } from 'electron';

import {
  TaskBoardIpc,
  type TaskBoardWorkEvent,
} from '../../shared/taskBoard/constants';

export function broadcastTaskBoardWorkEvent(event: TaskBoardWorkEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(TaskBoardIpc.WorkEvent, event);
    }
  }
}
