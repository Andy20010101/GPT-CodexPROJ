export function normalizeSignal(signal: string | undefined): NodeJS.Signals {
  switch (signal) {
    case 'SIGINT':
    case 'SIGKILL':
    case 'SIGTERM':
      return signal;
    default:
      return 'SIGTERM';
  }
}
