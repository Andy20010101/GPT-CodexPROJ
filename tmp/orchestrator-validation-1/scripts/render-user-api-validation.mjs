import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const workspaceRoot = process.cwd();
const targetDir = path.join(workspaceRoot, 'tmp', 'e2e-targets', 'user-api-validation-1');
const stage = Number.parseInt(process.argv[2] ?? '', 10);

if (!Number.isInteger(stage) || stage < 1 || stage > 4) {
  console.error('Usage: node render-user-api-validation.mjs <stage 1..4>');
  process.exit(2);
}

const rootVitest = path.join(repoRoot, 'node_modules', '.bin', 'vitest');
const rootTsc = path.join(repoRoot, 'node_modules', '.bin', 'tsc');

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      CI: '1',
    },
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function buildFiles(stageNumber) {
  const files = {
    'package.json': PACKAGE_JSON,
    'tsconfig.json': TSCONFIG,
    'src/types.ts': TYPES_TS,
    'src/errors.ts': ERRORS_TS,
    'src/cache.ts': CACHE_TS,
    'src/logger.ts': LOGGER_TS,
    'src/user-repository.ts': USER_REPOSITORY_TS,
  };

  if (stageNumber === 1) {
    return {
      ...files,
      'src/user-service.ts': FOUNDATION_SERVICE_TS,
      'tests/user-repository.test.ts': USER_REPOSITORY_TEST_TS,
      'tests/user-service.test.ts': FOUNDATION_SERVICE_TEST_TS,
    };
  }

  if (stageNumber === 2) {
    return {
      ...files,
      'src/user-service.ts': CACHE_SERVICE_TS,
      'tests/cache.test.ts': CACHE_TEST_TS,
      'tests/user-repository.test.ts': USER_REPOSITORY_TEST_TS,
      'tests/user-service.test.ts': CACHE_SERVICE_TEST_TS,
    };
  }

  if (stageNumber === 3) {
    return {
      ...files,
      'src/user-service.ts': CACHE_SERVICE_TS,
      'src/http.ts': HTTP_TS,
      'tests/cache.test.ts': CACHE_TEST_TS,
      'tests/user-repository.test.ts': USER_REPOSITORY_TEST_TS,
      'tests/user-service.test.ts': CACHE_SERVICE_TEST_TS,
      'tests/http.test.ts': HTTP_TEST_TS,
    };
  }

  return {
    ...files,
    'src/user-service.ts': CACHE_SERVICE_TS,
    'src/http.ts': HTTP_TS,
    'src/app.ts': APP_TS,
    'tests/cache.test.ts': CACHE_TEST_TS,
    'tests/user-repository.test.ts': USER_REPOSITORY_TEST_TS,
    'tests/user-service.test.ts': CACHE_SERVICE_TEST_TS,
    'tests/http.test.ts': HTTP_TEST_TS,
    'tests/app.test.ts': APP_TEST_TS,
  };
}

const PACKAGE_JSON = `
{
  "name": "user-api-validation-1",
  "private": true,
  "type": "module"
}
`;

const TSCONFIG = `
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
`;

const TYPES_TS = `
export type User = {
  id: string;
  name: string;
  email: string;
};
`;

const ERRORS_TS = `
export class InvalidUserIdError extends Error {
  public constructor(message = 'User id must be provided') {
    super(message);
    this.name = 'InvalidUserIdError';
  }
}

export class UserNotFoundError extends Error {
  public constructor(public readonly userId: string) {
    super(\`User \${userId} was not found\`);
    this.name = 'UserNotFoundError';
  }
}
`;

const LOGGER_TS = `
export type LogEntry = {
  level: 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, unknown>;
};

export class MemoryLogger {
  public readonly entries: LogEntry[] = [];

  public info(message: string, context?: Record<string, unknown>): void {
    this.entries.push({ level: 'info', message, context });
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    this.entries.push({ level: 'warn', message, context });
  }

  public error(message: string, context?: Record<string, unknown>): void {
    this.entries.push({ level: 'error', message, context });
  }
}
`;

const USER_REPOSITORY_TS = `
import type { User } from './types.js';

export type UserRepository = {
  findById(id: string): User | null;
};

const USERS: User[] = [
  { id: 'u-1', name: 'Ada Lovelace', email: 'ada@example.com' },
  { id: 'u-2', name: 'Grace Hopper', email: 'grace@example.com' }
];

export function createInMemoryUserRepository(): UserRepository {
  return {
    findById(id: string): User | null {
      return USERS.find((user) => user.id === id) ?? null;
    }
  };
}
`;

const CACHE_TS = `
import type { User } from './types.js';

export type UserCache = {
  get(key: string): User | null;
  set(key: string, value: User): void;
};

export function createUserCache(ttlMs: number, now: () => number = () => Date.now()): UserCache {
  const entries = new Map<string, { value: User; expiresAt: number }>();

  return {
    get(key: string): User | null {
      const entry = entries.get(key);
      if (!entry) {
        return null;
      }

      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return null;
      }

      return entry.value;
    },
    set(key: string, value: User): void {
      entries.set(key, {
        value,
        expiresAt: now() + ttlMs
      });
    }
  };
}
`;

const FOUNDATION_SERVICE_TS = `
import { createUserCache, type UserCache } from './cache.js';
import { InvalidUserIdError, UserNotFoundError } from './errors.js';
import { MemoryLogger } from './logger.js';
import {
  createInMemoryUserRepository,
  type UserRepository,
} from './user-repository.js';
import type { User } from './types.js';

export type UserService = {
  getUserById(id: string): User;
  logger: MemoryLogger;
};

export function createUserService(
  {
    repository = createInMemoryUserRepository(),
    cache = createUserCache(30_000),
    logger = new MemoryLogger(),
  }: {
    repository?: UserRepository;
    cache?: UserCache;
    logger?: MemoryLogger;
  } = {},
): UserService {
  return {
    logger,
    getUserById(id: string): User {
      const normalized = id.trim();
      if (normalized.length === 0) {
        logger.warn('invalid user id', { id });
        throw new InvalidUserIdError();
      }

      const cached = cache.get(normalized);
      if (cached !== null) {
        logger.info('user cache hit', { id: normalized });
        return cached;
      }

      const user = repository.findById(normalized);
      if (user === null) {
        logger.warn('user not found', { id: normalized });
        throw new UserNotFoundError(normalized);
      }

      cache.set(normalized, user);
      logger.info('user loaded', { id: normalized });
      return user;
    }
  };
}
`;

const CACHE_SERVICE_TS = `
import { createUserCache, type UserCache } from './cache.js';
import { InvalidUserIdError, UserNotFoundError } from './errors.js';
import { MemoryLogger } from './logger.js';
import {
  createInMemoryUserRepository,
  type UserRepository,
} from './user-repository.js';
import type { User } from './types.js';

export type UserService = {
  getUserById(id: string): User;
  logger: MemoryLogger;
};

export function createUserService(
  {
    repository = createInMemoryUserRepository(),
    cache = createUserCache(30_000),
    logger = new MemoryLogger(),
  }: {
    repository?: UserRepository;
    cache?: UserCache;
    logger?: MemoryLogger;
  } = {},
): UserService {
  return {
    logger,
    getUserById(id: string): User {
      const normalized = id.trim();
      if (normalized.length === 0) {
        logger.warn('invalid user id', { id });
        throw new InvalidUserIdError();
      }

      const cached = cache.get(normalized);
      if (cached !== null) {
        logger.info('user cache hit', { id: normalized });
        return cached;
      }

      const user = repository.findById(normalized);
      if (user === null) {
        logger.warn('user not found', { id: normalized });
        throw new UserNotFoundError(normalized);
      }

      cache.set(normalized, user);
      logger.info('user loaded', { id: normalized });
      return user;
    }
  };
}
`;

const FOUNDATION_SERVICE_TEST_TS = `
import { describe, expect, it } from 'vitest';

import { createUserCache } from '../src/cache.js';
import { InvalidUserIdError, UserNotFoundError } from '../src/errors.js';
import { MemoryLogger } from '../src/logger.js';
import { createUserService } from '../src/user-service.js';
import type { UserRepository } from '../src/user-repository.js';

describe('user service foundation', () => {
  it('returns the requested user for a trimmed id', () => {
    const logger = new MemoryLogger();
    const service = createUserService({ logger });

    expect(service.getUserById(' u-1 ')).toEqual({
      id: 'u-1',
      name: 'Ada Lovelace',
      email: 'ada@example.com'
    });
    expect(logger.entries.at(-1)).toMatchObject({
      level: 'info',
      message: 'user loaded',
      context: { id: 'u-1' }
    });
  });

  it('rejects a blank id with a typed error', () => {
    const logger = new MemoryLogger();
    const service = createUserService({ logger });

    expect(() => service.getUserById('  ')).toThrowError(InvalidUserIdError);
    expect(logger.entries.at(-1)).toMatchObject({
      level: 'warn',
      message: 'invalid user id'
    });
  });

  it('rejects a missing user with a typed error', () => {
    const logger = new MemoryLogger();
    const service = createUserService({ logger });

    expect(() => service.getUserById('u-999')).toThrowError(UserNotFoundError);
    expect(logger.entries.at(-1)).toMatchObject({
      level: 'warn',
      message: 'user not found',
      context: { id: 'u-999' }
    });
  });

  it('uses the cache on repeated lookups', () => {
    let lookups = 0;
    const logger = new MemoryLogger();
    const repository: UserRepository = {
      findById(id) {
        lookups += 1;
        if (id === 'u-1') {
          return {
            id: 'u-1',
            name: 'Ada Lovelace',
            email: 'ada@example.com'
          };
        }

        return null;
      }
    };
    const service = createUserService({ repository, logger });

    expect(service.getUserById('u-1').email).toBe('ada@example.com');
    expect(service.getUserById('u-1').email).toBe('ada@example.com');
    expect(lookups).toBe(1);
    expect(logger.entries.some((entry) => entry.message === 'user cache hit')).toBe(true);
  });

  it('reloads from the repository after cache expiry', () => {
    let lookups = 0;
    let now = 1_000;
    const repository: UserRepository = {
      findById(id) {
        lookups += 1;
        if (id === 'u-1') {
          return {
            id: 'u-1',
            name: 'Ada Lovelace',
            email: 'ada@example.com'
          };
        }

        return null;
      }
    };
    const cache = createUserCache(10, () => now);
    const service = createUserService({ repository, cache });

    service.getUserById('u-1');
    now += 20;
    service.getUserById('u-1');

    expect(lookups).toBe(2);
  });

  it('does not cache failed lookups', () => {
    let lookups = 0;
    const repository: UserRepository = {
      findById() {
        lookups += 1;
        return null;
      }
    };
    const service = createUserService({ repository });

    expect(() => service.getUserById('u-404')).toThrowError(UserNotFoundError);
    expect(() => service.getUserById('u-404')).toThrowError(UserNotFoundError);
    expect(lookups).toBe(2);
  });
});
`;

const CACHE_SERVICE_TEST_TS = `
import { describe, expect, it } from 'vitest';

import { createUserCache } from '../src/cache.js';
import { InvalidUserIdError, UserNotFoundError } from '../src/errors.js';
import { MemoryLogger } from '../src/logger.js';
import { createUserService } from '../src/user-service.js';
import type { UserRepository } from '../src/user-repository.js';

describe('user service with cache', () => {
  it('returns the requested user', () => {
    const service = createUserService();

    expect(service.getUserById('u-1')).toEqual({
      id: 'u-1',
      name: 'Ada Lovelace',
      email: 'ada@example.com'
    });
  });

  it('rejects invalid ids with a specific error', () => {
    const service = createUserService();
    expect(() => service.getUserById('  ')).toThrowError(InvalidUserIdError);
  });

  it('rejects a missing user with a specific error', () => {
    const service = createUserService();
    expect(() => service.getUserById('u-999')).toThrowError(UserNotFoundError);
  });

  it('returns a cached user on the second lookup', () => {
    let lookups = 0;
    const logger = new MemoryLogger();
    const repository: UserRepository = {
      findById(id) {
        lookups += 1;
        if (id === 'u-1') {
          return {
            id: 'u-1',
            name: 'Ada Lovelace',
            email: 'ada@example.com'
          };
        }

        return null;
      }
    };

    const service = createUserService({ repository, logger });

    expect(service.getUserById('u-1').email).toBe('ada@example.com');
    expect(service.getUserById('u-1').email).toBe('ada@example.com');
    expect(lookups).toBe(1);
    expect(logger.entries.some((entry) => entry.message === 'user cache hit')).toBe(true);
  });

  it('reloads from the repository after cache expiry', () => {
    let lookups = 0;
    let now = 1_000;
    const repository: UserRepository = {
      findById(id) {
        lookups += 1;
        if (id === 'u-1') {
          return {
            id: 'u-1',
            name: 'Ada Lovelace',
            email: 'ada@example.com'
          };
        }

        return null;
      }
    };
    const cache = createUserCache(10, () => now);
    const service = createUserService({ repository, cache });

    service.getUserById('u-1');
    now += 20;
    service.getUserById('u-1');

    expect(lookups).toBe(2);
  });

  it('does not cache failed lookups', () => {
    let lookups = 0;
    const repository: UserRepository = {
      findById() {
        lookups += 1;
        return null;
      }
    };
    const service = createUserService({ repository });

    expect(() => service.getUserById('u-404')).toThrowError(UserNotFoundError);
    expect(() => service.getUserById('u-404')).toThrowError(UserNotFoundError);
    expect(lookups).toBe(2);
  });
});
`;

const USER_REPOSITORY_TEST_TS = `
import { describe, expect, it } from 'vitest';

import { createInMemoryUserRepository } from '../src/user-repository.js';

describe('in-memory user repository', () => {
  it('returns a user for a known id', () => {
    const repository = createInMemoryUserRepository();

    expect(repository.findById('u-1')).toEqual({
      id: 'u-1',
      name: 'Ada Lovelace',
      email: 'ada@example.com'
    });
  });

  it('returns null for an unknown id', () => {
    const repository = createInMemoryUserRepository();

    expect(repository.findById('u-404')).toBeNull();
  });
});
`;

const CACHE_TEST_TS = `
import { describe, expect, it } from 'vitest';

import { createUserCache } from '../src/cache.js';

describe('user cache', () => {
  it('returns a cached user before expiry', () => {
    let now = 10;
    const cache = createUserCache(50, () => now);

    cache.set('u-1', {
      id: 'u-1',
      name: 'Ada Lovelace',
      email: 'ada@example.com'
    });

    expect(cache.get('u-1')?.email).toBe('ada@example.com');
    now += 30;
    expect(cache.get('u-1')?.email).toBe('ada@example.com');
  });

  it('treats expired entries as empty', () => {
    let now = 10;
    const cache = createUserCache(5, () => now);

    cache.set('u-1', {
      id: 'u-1',
      name: 'Ada Lovelace',
      email: 'ada@example.com'
    });
    now += 10;

    expect(cache.get('u-1')).toBeNull();
  });
});
`;

const HTTP_TS = `
import { InvalidUserIdError, UserNotFoundError } from './errors.js';
import { createUserService, type UserService } from './user-service.js';

export type HttpResponse = {
  statusCode: number;
  body: Record<string, unknown>;
};

export function handleGetUserRequest(
  pathname: string,
  service: UserService = createUserService(),
): HttpResponse {
  if (!pathname.startsWith('/user/')) {
    return {
      statusCode: 404,
      body: {
        error: {
          code: 'ROUTE_NOT_FOUND',
          message: 'Route not found'
        }
      }
    };
  }

  const id = decodeURIComponent(pathname.slice('/user/'.length));

  try {
    const user = service.getUserById(id);
    return {
      statusCode: 200,
      body: user
    };
  } catch (error) {
    if (error instanceof InvalidUserIdError) {
      return {
        statusCode: 400,
        body: {
          error: {
            code: 'INVALID_ID',
            message: error.message
          }
        }
      };
    }

    if (error instanceof UserNotFoundError) {
      return {
        statusCode: 404,
        body: {
          error: {
            code: 'USER_NOT_FOUND',
            message: error.message
          }
        }
      };
    }

    throw error;
  }
}
`;

const HTTP_TEST_TS = `
import { describe, expect, it } from 'vitest';

import { MemoryLogger } from '../src/logger.js';
import { handleGetUserRequest } from '../src/http.js';
import { createUserService } from '../src/user-service.js';

describe('GET /user/:id handler', () => {
  it('returns a user payload for a valid id', () => {
    const response = handleGetUserRequest('/user/u-1');

    expect(response).toEqual({
      statusCode: 200,
      body: {
        id: 'u-1',
        name: 'Ada Lovelace',
        email: 'ada@example.com'
      }
    });
  });

  it('returns a structured invalid-id error', () => {
    const response = handleGetUserRequest('/user/%20%20');

    expect(response).toEqual({
      statusCode: 400,
      body: {
        error: {
          code: 'INVALID_ID',
          message: 'User id must be provided'
        }
      }
    });
  });

  it('returns a structured not-found error', () => {
    const logger = new MemoryLogger();
    const service = createUserService({ logger });
    const response = handleGetUserRequest('/user/u-404', service);

    expect(response).toEqual({
      statusCode: 404,
      body: {
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User u-404 was not found'
        }
      }
    });
    expect(logger.entries.at(-1)).toMatchObject({
      level: 'warn',
      message: 'user not found'
    });
  });
});
`;

const APP_TS = `
import { handleGetUserRequest } from './http.js';
import { createUserService, type UserService } from './user-service.js';

export type UserApiApp = {
  handle(method: string, pathname: string): { statusCode: number; body: Record<string, unknown> };
};

export function createUserApiApp(service: UserService = createUserService()): UserApiApp {
  return {
    handle(method: string, pathname: string) {
      if (method !== 'GET') {
        return {
          statusCode: 405,
          body: {
            error: {
              code: 'METHOD_NOT_ALLOWED',
              message: 'Only GET is supported'
            }
          }
        };
      }

      return handleGetUserRequest(pathname, service);
    }
  };
}
`;

const APP_TEST_TS = `
import { describe, expect, it } from 'vitest';

import { createUserApiApp } from '../src/app.js';
import { MemoryLogger } from '../src/logger.js';
import { createUserService } from '../src/user-service.js';

describe('user api app', () => {
  it('rejects unsupported methods', () => {
    const app = createUserApiApp();

    expect(app.handle('POST', '/user/u-1')).toEqual({
      statusCode: 405,
      body: {
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: 'Only GET is supported'
        }
      }
    });
  });

  it('reuses the service cache across repeated GETs', () => {
    const logger = new MemoryLogger();
    const service = createUserService({ logger });
    const app = createUserApiApp(service);

    expect(app.handle('GET', '/user/u-1').statusCode).toBe(200);
    expect(app.handle('GET', '/user/u-1').statusCode).toBe(200);
    expect(logger.entries.some((entry) => entry.message === 'user cache hit')).toBe(true);
  });
});
`;

await fs.rm(targetDir, { recursive: true, force: true });
await fs.mkdir(path.join(targetDir, 'src'), { recursive: true });
await fs.mkdir(path.join(targetDir, 'tests'), { recursive: true });

for (const [relativePath, content] of Object.entries(buildFiles(stage))) {
  const fullPath = path.join(targetDir, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, `${content.trim()}\n`, 'utf8');
}

run(rootVitest, ['run'], targetDir);

if (stage >= 4) {
  run(rootTsc, ['--noEmit', '-p', 'tsconfig.json'], targetDir);
}
