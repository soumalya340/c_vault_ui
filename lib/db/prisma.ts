import "server-only";
import { PrismaClient } from "@/lib/generated/prisma";

/**
 * Client-only Prisma over the SQLite DB owned by c_vault_script
 * (c_vault_script/lib/db/schema.sql). Never run `prisma migrate` or
 * `prisma db push` here — the CLI script owns the schema.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient();
  }
  return globalForPrisma.prisma;
}
