module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'prettier',
  ],
  ignorePatterns: ['dist', 'coverage', 'node_modules'],
  overrides: [
    {
      files: ['apps/orchestrator/**/*.ts'],
      parserOptions: {
        project: ['./apps/orchestrator/tsconfig.json'],
        tsconfigRootDir: __dirname,
      },
    },
    {
      files: ['services/chatgpt-web-bridge/**/*.ts'],
      parserOptions: {
        project: ['./services/chatgpt-web-bridge/tsconfig.json'],
        tsconfigRootDir: __dirname,
      },
    },
    {
      files: ['packages/shared-contracts/**/*.ts'],
      parserOptions: {
        project: ['./packages/shared-contracts/tsconfig.json'],
        tsconfigRootDir: __dirname,
      },
    },
    {
      files: ['scripts/**/*.ts'],
      parserOptions: {
        project: ['./tsconfig.scripts.json'],
        tsconfigRootDir: __dirname,
      },
    },
    {
      files: ['**/*.test.ts', '**/*.spec.ts'],
      rules: {
        '@typescript-eslint/no-unnecessary-type-assertion': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/no-var-requires': 'off',
        '@typescript-eslint/require-await': 'off',
        '@typescript-eslint/unbound-method': 'off',
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      },
    },
  ],
};
