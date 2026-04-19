import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // pgbo uses `any` for phantom types in generic builders (ViewDef, ColumnRef)
      '@typescript-eslint/no-explicit-any': 'off',
      // Callback return types like `void | string | Promise<...>` are a valid pattern
      '@typescript-eslint/no-invalid-void-type': 'off',
      // Stylistic preferences that don't add safety
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/prefer-regexp-exec': 'off',
      '@typescript-eslint/prefer-for-of': 'off',
      '@typescript-eslint/no-unnecessary-type-arguments': 'off',
      '@typescript-eslint/dot-notation': 'off',
      // Numbers in template literals are fine
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true }],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      // Test code probes types and runtime — relax safety rules that production code enforces
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-deprecated': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/require-await': 'off',
      // Non-null assertions in tests typically follow expect(x).toBeDefined()
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Tests inspect result rows with unknown types from DB
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // Test framework setup sometimes uses .then-less promises
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/array-type': 'off',
    },
  },
)
