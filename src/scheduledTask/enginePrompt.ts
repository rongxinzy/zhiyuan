export function buildScheduledTaskEnginePrompt(): string {
  return [
    '## Scheduled Tasks',
    '- Use the ZhiYuan scheduled-task API to create or manage schedules. SQLite stores schedule configuration and display records; Pi Durable Task owns execution and recovery.',
    '- Preserve the task-selected execution session binding and active conversation context.',
    '- For one-time reminders (`schedule.kind: "at"`), use a future ISO timestamp with an explicit timezone offset.',
    '- Results are available in the application session and execution history.',
  ].join('\n');
}
