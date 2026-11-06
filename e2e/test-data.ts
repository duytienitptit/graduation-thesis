import { randomUUID } from 'node:crypto';
import pg from 'pg';

export const CUSTOMER = { email: 'khach@e2e.test', name: 'Khách E2E' };
export const DESIGNER = { email: 'designer@e2e.test', name: 'Designer E2E' };

async function withDatabase<T>(run: (client: pg.Client) => Promise<T>) {
  process.loadEnvFile('.env');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Tests share the dev database, so everything here hangs off the two e2e accounts. */
export const removeTestData = () =>
  withDatabase(async (client) => {
    const owned = `(select id from "User" where email like '%@e2e.test')`;
    const sessions = `(select id from "DesignSession" where "customerId" in ${owned})`;
    const tasks = `(select id from "Task" where "customerId" in ${owned})`;
    const designers = `(select id from "DesignerProfile" where "userId" in ${owned})`;

    for (const statement of [
      `delete from "TaskMessage" where "taskId" in ${tasks}`,
      `delete from "TaskNotice" where "taskId" in ${tasks} or "designerId" in ${designers}`,
      `delete from "Task" where id in ${tasks}`,
      `delete from "LockedProduct" where "sessionId" in ${sessions}`,
      `delete from "AiJob" where "sessionId" in ${sessions}`,
      `delete from "ProductView" where "sessionId" in ${sessions}`,
      `delete from "DesignVersion" where "sessionId" in ${sessions}`,
      `delete from "DesignSession" where id in ${sessions}`,
      `delete from "FileObject" where "ownerId" in ${owned}`,
      `delete from "DesignerProfile" where id in ${designers}`,
      `delete from "User" where email like '%@e2e.test'`,
    ]) {
      await client.query(statement);
    }
  });

export const createTestUsers = () =>
  withDatabase(async (client) => {
    const insertUser = `insert into "User" (id, email, name, role) values ($1, $2, $3, $4)`;
    await client.query(insertUser, [randomUUID(), CUSTOMER.email, CUSTOMER.name, 'CUSTOMER']);

    const designerId = randomUUID();
    await client.query(insertUser, [designerId, DESIGNER.email, DESIGNER.name, 'DESIGNER']);
    await client.query(
      `insert into "DesignerProfile" (id, "userId", "updatedAt") values ($1, $2, now())`,
      [randomUUID(), designerId],
    );
  });
