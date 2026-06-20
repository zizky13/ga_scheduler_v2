import { PrismaClient, Role } from '@prisma/client';
import { hashPassword } from '../src/api/lib/auth.js';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.DEMO_ADMIN_EMAIL ?? 'admin@upj.ac.id';
  const password = process.env.DEMO_ADMIN_PASSWORD ?? 'Admin12345';
  const fullName = process.env.DEMO_ADMIN_NAME ?? 'Admin Demo';

  const passwordHash = await hashPassword(password);

  await prisma.user.upsert({
    where: { email },
    update: {
      fullName,
      passwordHash,
      role: Role.ADMIN,
      isActive: true,
    },
    create: {
      email,
      fullName,
      passwordHash,
      role: Role.ADMIN,
      isActive: true,
    },
  });

  console.log(`Demo admin ready: ${email}`);
}

main()
  .catch((err) => {
    console.error('Demo admin seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
