import { ipcMain } from 'electron';

import { IpcChannel as ScheduledTaskIpc } from '../../../scheduledTask/constants';
import type { ScheduledTaskService } from '../../../scheduledTask/scheduledTaskService';
import type { ScheduledTaskInput } from '../../../scheduledTask/types';

export interface ScheduledTaskHandlerDeps {
  getCronJobService: () => ScheduledTaskService;
}

export function registerScheduledTaskHandlers(deps: ScheduledTaskHandlerDeps): void {
  const { getCronJobService } = deps;

  ipcMain.handle(ScheduledTaskIpc.List, async () => {
    try {
      const tasks = await getCronJobService().listJobs();
      return { success: true, tasks };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list tasks',
      };
    }
  });

  ipcMain.handle(ScheduledTaskIpc.Get, async (_event, id: string) => {
    try {
      const task = await getCronJobService().getJob(id);
      return { success: true, task };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get task',
      };
    }
  });

  ipcMain.handle(ScheduledTaskIpc.Create, async (_event, input: ScheduledTaskInput) => {
    try {
      const task = await getCronJobService().addJob(input);
      console.log(`[ScheduledTask] created task ${task.id}`);
      return { success: true, task };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create task',
      };
    }
  });

  ipcMain.handle(
    ScheduledTaskIpc.Update,
    async (_event, id: string, input: Partial<ScheduledTaskInput>) => {
      try {
        const task = await getCronJobService().updateJob(id, input);
        console.log(`[ScheduledTask] updated task ${task.id}`);
        return { success: true, task };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update task',
        };
      }
    },
  );

  ipcMain.handle(ScheduledTaskIpc.Delete, async (_event, id: string) => {
    try {
      await getCronJobService().removeJob(id);
      return { success: true, result: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete task',
      };
    }
  });

  ipcMain.handle(ScheduledTaskIpc.Toggle, async (_event, id: string, enabled: boolean) => {
    try {
      const task = await getCronJobService().toggleJob(id, enabled);
      return { success: true, task };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to toggle task',
      };
    }
  });

  ipcMain.handle(ScheduledTaskIpc.RunManually, async (_event, id: string) => {
    try {
      await getCronJobService().runJob(id);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[IPC] Manual run failed for ${id}:`, msg);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle(ScheduledTaskIpc.Stop, async (_event, id: string) => {
    try {
      return { success: true, result: await getCronJobService().stopJob(id) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop task',
      };
    }
  });

  ipcMain.handle(
    ScheduledTaskIpc.ListRuns,
    async (
      _event,
      taskId: string,
      limit?: number,
      offset?: number,
      filter?: import('../../../scheduledTask/types').RunFilter,
    ) => {
      try {
        const runs = await getCronJobService().listRuns(taskId, limit, offset, filter);
        return { success: true, runs };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list runs',
        };
      }
    },
  );

  ipcMain.handle(ScheduledTaskIpc.CountRuns, async (_event, taskId: string) => {
    try {
      const count = await getCronJobService().countRuns(taskId);
      return { success: true, count };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to count runs',
      };
    }
  });

  ipcMain.handle(
    ScheduledTaskIpc.ListAllRuns,
    async (
      _event,
      limit?: number,
      offset?: number,
      filter?: import('../../../scheduledTask/types').RunFilter,
    ) => {
      try {
        const runs = await getCronJobService().listAllRuns(limit, offset, filter);
        return { success: true, runs };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list all runs',
        };
      }
    },
  );

  ipcMain.handle(ScheduledTaskIpc.ResolveSession, async (_event, sessionKey: string) => {
    try {
      if (!sessionKey) return { success: true, session: null };
      // Canonical Runs store their Pi session id directly. There is no remote
      // scheduler session authority to query by an opaque legacy session key.
      return { success: true, session: null };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to resolve session',
      };
    }
  });
}
