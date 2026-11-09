// Keeps test jobs away from a dev worker running on the same Redis.
process.env.QUEUE_PREFIX = 'test';
process.env.IMAGE_PROVIDER = 'fake';
process.env.AI_RETRY_DELAY_MS = '10';
process.env.TELEGRAM_ENABLED = 'false';
process.env.TASK_CHECKS_ENABLED = 'false';
