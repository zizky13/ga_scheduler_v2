/**
 * Thin repository facade around `prisma.user` for the `/auth/*` and
 * `/users/*` endpoints. Keeps Prisma imports out of the route handlers so the
 * boundary stays explicit.
 */

import type { PrismaClient, Prisma, Role, User } from '@prisma/client';

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

export interface UpdateUserInput {
  role?: Role;
  fullName?: string;
  isActive?: boolean;
}

export interface ListUsersOptions {
  filter?: { role?: Role; isActive?: boolean };
  page: number;
  pageSize: number;
  sort?: string;
}

export interface ListResult<T> {
  rows: T[];
  total: number;
}

export interface UserRepository {
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: number): Promise<UserRecord | null>;
  createUser(input: CreateUserInput): Promise<UserRecord>;
  updateLastLogin(id: number, when: Date): Promise<void>;
  setActive(id: number, isActive: boolean): Promise<UserRecord>;
  listUsers(opts: ListUsersOptions): Promise<ListResult<UserRecord>>;
  updateUser(id: number, patch: UpdateUserInput): Promise<UserRecord>;
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
    async listUsers({ filter, page, pageSize, sort }) {
      const where: Prisma.UserWhereInput = {};
      if (filter?.role !== undefined) where.role = filter.role;
      if (filter?.isActive !== undefined) where.isActive = filter.isActive;
      const orderBy = parseUserSort(sort);
      const [rows, total] = await Promise.all([
        prisma.user.findMany({
          where,
          orderBy: orderBy.length > 0 ? orderBy : [{ createdAt: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: USER_SELECT,
        }),
        prisma.user.count({ where }),
      ]);
      return { rows, total };
    },
    async updateUser(id, patch) {
      return prisma.user.update({
        where: { id },
        data: patch,
        select: USER_SELECT,
      });
    },
  };
}

const USER_SORTABLE = new Set(['createdAt', 'email', 'fullName']);

function parseUserSort(sort: string | undefined): Prisma.UserOrderByWithRelationInput[] {
  if (!sort) return [{ createdAt: 'desc' }];
  return sort
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((token) => {
      const dir: 'asc' | 'desc' = token.startsWith('-') ? 'desc' : 'asc';
      const field = token.replace(/^[-+]/u, '');
      if (!USER_SORTABLE.has(field)) return null;
      return { [field]: dir } as Prisma.UserOrderByWithRelationInput;
    })
    .filter((v): v is Prisma.UserOrderByWithRelationInput => v !== null);
}
