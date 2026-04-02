import { createOrchestratorRuntimeBundle } from '../apps/orchestrator/src';
import { buildServer } from '../apps/orchestrator/src/api/server';
import { loadOrchestratorConfig } from '../apps/orchestrator/src/config';
import { registerGracefulShutdown } from '../apps/orchestrator/src/utils/graceful-shutdown';

async function main(): Promise<void> {
  const config = loadOrchestratorConfig();
  const bundle = createOrchestratorRuntimeBundle();
  await bundle.recoveryService.recover();
  await bundle.daemonRuntimeService.start({
    autoPolling: true,
    requestedBy: 'run-orchestrator-daemon',
  });
  if (process.env.ORCHESTRATOR_DISABLE_LISTEN === 'true') {
    const unregister = registerGracefulShutdown({
      shutdown: async () => {
        await bundle.daemonRuntimeService.shutdown('signal', 'daemon script shutdown');
        unregister();
      },
    });
    await new Promise<void>(() => undefined);
    return;
  }

  const app = buildServer({
    runtimeBundle: bundle,
    logger: true,
  });
  const unregister = registerGracefulShutdown({
    shutdown: async () => {
      await bundle.daemonRuntimeService.shutdown('signal', 'daemon script shutdown');
      unregister();
      await app.close();
    },
  });

  await app.listen({
    host: config.apiHost,
    port: config.apiPort,
  });
}

void main();
