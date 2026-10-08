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

// Rule 8: all database access goes through the record layer in src/record/.
// No SQL anywhere else, apart from the migration files and the one test
// helper allowed to read the database directly (docs/decisions.md, 8 Oct).
// test/fixtures/lint/ holds deliberate mistakes that show both rules work.
const D1_TYPES = new Set(['D1Database', 'D1DatabaseSession', 'D1PreparedStatement']);
// Uppercase, as the record layer writes it, so ordinary words do not match.
const LOOKS_LIKE_SQL =
  /\b(?:SELECT\b[\s\S]*\bFROM|INSERT\s+(?:OR\s+[A-Z]+\s+)?INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM|(?:CREATE|DROP|ALTER)\s+(?:TABLE|INDEX|TRIGGER|VIEW)|PRAGMA\s+[a-z_]+)\b/;

const frontline = {
  rules: {
    // Using the database: anything done to a D1 database, session or
    // statement. The types tell which objects those are, whatever they are
    // called.
    'database-outside-record': {
      meta: {
        type: 'problem',
        schema: [],
        messages: { used: 'Rule 8: only the record layer in src/record/ uses the database.' },
      },
      create(context) {
        const services = context.sourceCode.parserServices;
        if (!services?.program) return {};
        const checker = services.program.getTypeChecker();
        const isD1 = (type) =>
          (type.isUnion() ? type.types : [type]).some((part) =>
            D1_TYPES.has((part.getSymbol() ?? part.aliasSymbol)?.getName() ?? ''),
          );
        const typeOf = (node) => checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node));
        return {
          // db.prepare(…), maybe?.exec(…)
          MemberExpression(node) {
            if (isD1(typeOf(node.object))) context.report({ node, messageId: 'used' });
          },
          // const { prepare } = db
          ObjectPattern(node) {
            if (isD1(typeOf(node))) context.report({ node, messageId: 'used' });
          },
        };
      },
    },
    // Writing SQL: any string that reads like a query.
    'sql-outside-record': {
      meta: {
        type: 'problem',
        schema: [],
        messages: { sql: 'Rule 8: SQL goes only in src/record/ and migrations/.' },
      },
      create(context) {
        return {
          Literal(node) {
            if (typeof node.value === 'string' && LOOKS_LIKE_SQL.test(node.value)) {
              context.report({ node, messageId: 'sql' });
            }
          },
          TemplateLiteral(node) {
            if (LOOKS_LIKE_SQL.test(node.quasis.map((quasi) => quasi.value.cooked ?? '').join(' '))) {
              context.report({ node, messageId: 'sql' });
            }
          },
        };
      },
    },
  },
};

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
    // A disable comment that no longer silences anything fails the check. The
    // deliberate mistakes in test/fixtures/lint/ rely on this.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: { frontline },
  },
  {
    rules: {
      'no-console': 'error',
      'no-restricted-properties': ['error', ...readsTheClock, ...guessable, ...fakesTheClock],
      'no-restricted-syntax': ['error', ...readsTheClockSyntax],
      'frontline/database-outside-record': 'error',
      'frontline/sql-outside-record': 'error',
    },
  },
  {
    // The record layer, and the one test helper that reads the database.
    files: ['src/record/**', 'test/helpers/db.ts'],
    rules: {
      'frontline/database-outside-record': 'off',
      'frontline/sql-outside-record': 'off',
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
