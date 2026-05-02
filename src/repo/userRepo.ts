/**
 * Thin repository facade around `prisma.user` for the `/auth/*` and (later)
 * `/users/*` endpoints. Keeps Prisma imports out of the route handlers so the
 * boundary stays explicit.
 *
 * Only the methods Phase 2 Task 3 actually calls live here; the broader user
 * CRUD surface (list, soft-delete via `setActive`, etc.) is added by Task 5.
 */

import type { PrismaClient, Role, User } from '@prisma/client';

export type UserRecord = Pick<
  User,
  'id' | 'email' | 'passwordHash' | 'fullName' | 'role' | 'isActive' | 'lastLoginAt' | 'createdAt' | 'updatedAt'
>;

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  fullName: string;
  role: Role;
}

export interface UserRepository {
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: number): Promise<UserRecord | null>;
  createUser(input: CreateUserInput): Promise<UserRecord>;
  updateLastLogin(id: number, when: Date): Promise<void>;
  setActive(id: number, isActive: boolean): Promise<UserRecord>;
}

const USER_SELECT = {
  id: true,
  email: true,
  passwordHash: true,
  fullName: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function createUserRepository(prisma: PrismaClient): UserRepository {
  return {
    async findUserByEmail(email) {
      return prisma.user.findUnique({
        where: { email },
        select: USER_SELECT,
      });
    },
    async findUserById(id) {
      return prisma.user.findUnique({
        where: { id },
        select: USER_SELECT,
      });
    },
    async createUser(input) {
      return prisma.user.create({
        data: {
          email: input.email,
          passwordHash: input.passwordHash,
          fullName: input.fullName,
          role: input.role,
        },
        select: USER_SELECT,
      });
    },
    async updateLastLogin(id, when) {
      await prisma.user.update({
        where: { id },
        data: { lastLoginAt: when },
      });
    },
    async setActive(id, isActive) {
      return prisma.user.update({
        where: { id },
        data: { isActive },
        select: USER_SELECT,
      });
    },
  };
}
