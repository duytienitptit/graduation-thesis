import { removeTestData } from './test-data';

export default async function teardown() {
  await removeTestData();
}
