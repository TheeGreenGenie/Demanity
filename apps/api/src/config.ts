// Runtime configuration, read from environment variables.
// Secrets never have defaults; anything required fails fast at startup.

export interface Config {
  host: string;
  port: number;
  logLevel: string;
  nodeEnv: 'development' | 'test' | 'production';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    throw new Error(`Invalid NODE_ENV: ${nodeEnv}`);
  }

  const port = Number(env.API_PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid API_PORT: ${env.API_PORT}`);
  }

  return {
    host: env.API_HOST ?? '127.0.0.1',
    port,
    logLevel: env.LOG_LEVEL ?? (nodeEnv === 'production' ? 'info' : 'debug'),
    nodeEnv,
  };
}
