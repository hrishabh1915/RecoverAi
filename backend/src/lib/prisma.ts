import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

function resolveDatabaseUrl(): string {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const tmpDb = path.join(os.tmpdir(), 'dev.db');
    if (!fs.existsSync(tmpDb)) {
      const candidates = [
        path.join(process.cwd(), 'backend', 'prisma', 'dev.db'),
        path.join(process.cwd(), 'prisma', 'dev.db'),
        path.resolve(process.cwd(), 'backend/prisma/dev.db'),
        path.resolve(process.cwd(), 'prisma/dev.db'),
        path.join(__dirname, '..', '..', 'prisma', 'dev.db'),
        path.join(__dirname, '..', '..', '..', 'backend', 'prisma', 'dev.db'),
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          try {
            fs.copyFileSync(candidate, tmpDb);
            break;
          } catch (err) {
            console.error('Failed to copy db from', candidate, err);
          }
        }
      }
    }
    return `file:${tmpDb}`;
  }

  return process.env.DATABASE_URL || 'file:./dev.db';
}

const dbUrl = resolveDatabaseUrl();
process.env.DATABASE_URL = dbUrl;

export const prisma =
  global.prismaGlobal ??
  new PrismaClient({
    datasources: {
      db: {
        url: dbUrl,
      },
    },
  });

if (process.env.NODE_ENV !== 'production') {
  global.prismaGlobal = prisma;
}

