import { createTestUsers, removeTestData } from './test-data';

export default async function setup() {
  // A stopped run may have left its data behind.
  await removeTestData();
  await createTestUsers();
}
