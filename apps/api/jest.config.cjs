// NestJS 12 ships ES modules only, so Jest runs in ESM mode (see the test script).
module.exports = {
  testEnvironment: 'node',
  rootDir: 'src',
  setupFiles: ['<rootDir>/../jest.setup.cjs'],
  testRegex: '.*\\.spec\\.ts$',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: { '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: 'tsconfig.json', diagnostics: { ignoreCodes: [151002] } }] },
};
