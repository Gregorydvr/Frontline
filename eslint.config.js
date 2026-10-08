import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

// Rule 19 in CLAUDE.md: nothing reads the system clock directly. Code is
// given the clock, so tests can use a pretend one.
const clockMessage =
  'Rule 19: use the Clock you were given (src/clock.ts). Only systemClock reads the system time.';
const readsTheClock = [
  { object: 'Date', property: 'now', message: clockMessage },
  { object: 'performance', property: 'now', message: clockMessage },
];
const readsTheClockSyntax = [
  { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: clockMessage },
  { selector: "CallExpression[callee.name='Date']", message: clockMessage },
];

// Ids and tokens must not be guessable. Math.random can be.
const guessable = [
  {
    object: 'Math',
    property: 'random',
    message: 'Math.random can be guessed. Use newId() from src/ids.ts, which uses the cryptographic random source.',
  },
];

// Tests move time with pretendClock, not by faking the system time.
const fakesTheClock = [
  { object: 'vi', property: 'setSystemTime', message: 'Use pretendClock from src/clock.ts.' },
];

export default defineConfig(
  { ignores: ['node_modules/', '.wrangler/', 'reference/', 'worker-configuration.d.ts'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js', 'vitest.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      'no-console': 'error',
      'no-restricted-properties': ['error', ...readsTheClock, ...guessable, ...fakesTheClock],
      'no-restricted-syntax': ['error', ...readsTheClockSyntax],
    },
  },
  {
    // The one place the system time is read.
    files: ['src/clock.ts'],
    rules: {
      'no-restricted-properties': ['error', ...guessable],
    },
  },
  {
    // The one place that writes to the console, with ids only (rule 11).
    files: ['src/log.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
