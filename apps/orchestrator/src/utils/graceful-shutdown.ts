export function registerGracefulShutdown(input: { shutdown: () => Promise<void> }): () => void {
  const handler = () => {
    void input.shutdown();
  };

  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);

  return () => {
    process.off('SIGINT', handler);
    process.off('SIGTERM', handler);
  };
}
