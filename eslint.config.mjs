// Единая конфигурация ESLint для всего монорепозитория (ARCHITECTURE.md, 4.2; SECURITY.md, 5).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/generated/**',
      '**/next-env.d.ts',
      '**/*.config.{js,mjs,cjs,ts}',
      '.dependency-cruiser.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/unbound-method': 'off',
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
      'max-lines': ['warn', { max: 400, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 60, skipBlankLines: true, skipComments: true }],
      'no-restricted-properties': [
        'error',
        { object: 'prisma', property: '$queryRawUnsafe', message: 'Только tagged template $queryRaw (SECURITY.md, 5).' },
        { object: 'prisma', property: '$executeRawUnsafe', message: 'Только tagged template $executeRaw (SECURITY.md, 5).' },
        { object: 'tx', property: '$queryRawUnsafe', message: 'Только tagged template $queryRaw (SECURITY.md, 5).' },
        { object: 'tx', property: '$executeRawUnsafe', message: 'Только tagged template $executeRaw (SECURITY.md, 5).' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML запрещён (SECURITY.md, 3.5).',
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/test/**/*.ts'],
    rules: {
      'max-lines-per-function': 'off',
      'max-lines': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['**/*.tsx'],
    languageOptions: { globals: { ...globals.browser } },
    rules: { 'max-lines-per-function': ['warn', { max: 150, skipBlankLines: true, skipComments: true }] },
  },
  prettier,
);
