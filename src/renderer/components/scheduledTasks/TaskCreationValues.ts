export interface TaskCreationValues {
  name: string;
  description: string;
  schedule: { kind: 'cron'; expr: string };
  promptText: string;
}
