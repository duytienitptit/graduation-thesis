'use client';

import { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import {
  ApiError,
  apiUrl,
  getTask,
  getTaskMessages,
  getToken,
  TaskDetail,
  TaskMessage,
} from '@/lib/api';

/** A task and its chat, kept live over Socket.IO. */
export function useTaskRoom(taskId: string) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [messages, setMessages] = useState<TaskMessage[]>([]);
  const [error, setError] = useState<ApiError | null>(null);

  const reloadTask = useCallback(async () => {
    try {
      setTask(await getTask(taskId));
    } catch (e) {
      setError(e as ApiError);
    }
  }, [taskId]);

  const reload = useCallback(async () => {
    try {
      const [nextTask, nextMessages] = await Promise.all([getTask(taskId), getTaskMessages(taskId)]);
      setTask(nextTask);
      setMessages(nextMessages);
    } catch (e) {
      setError(e as ApiError);
    }
  }, [taskId]);

  useEffect(() => {
    void reload();
    const socket = io(apiUrl, { auth: { token: getToken() } });
    // Reloading on connect also covers anything missed while offline.
    socket.on('connect', () => void reload());
    socket.on('task.message', (message: TaskMessage) => {
      if (message.taskId !== taskId) return;
      setMessages((current) =>
        current.some((known) => known.id === message.id) ? current : [...current, message],
      );
    });
    socket.on('design.task', (event: { taskId: string }) => {
      if (event.taskId === taskId) void reloadTask();
    });
    return () => {
      socket.disconnect();
    };
  }, [reload, reloadTask, taskId]);

  return { task, messages, error, reloadTask };
}

export type TaskRoom = ReturnType<typeof useTaskRoom>;
