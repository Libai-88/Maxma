import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  // Global ignores
  { ignores: ['dist/**', 'node_modules/**', '*.d.ts'] },

  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript recommended rules
  ...tseslint.configs.recommended,

  // Vue 3 recommended rules (flat config)
  ...pluginVue.configs['flat/recommended'],

  // Browser globals + Vue file parser
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2021 },
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },

  // Project-specific rule adjustments
  {
    rules: {
      // TypeScript handles unused vars better than base ESLint
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],

      // Allow explicit any in migration contexts (warn, not error)
      '@typescript-eslint/no-explicit-any': 'warn',

      // Allow console in dev (production build strips it)
      'no-console': 'off',

      // Vue: allow multi-word component names (views are often single-word)
      'vue/multi-word-component-names': 'off',

      // Vue: don't require default value for all props
      'vue/require-default-prop': 'off',

      // Vue: allow v-html (used for markdown rendering)
      'vue/no-v-html': 'off',

      // Pre-existing issues — warn for now, fix incrementally
      'vue/no-side-effects-in-computed-properties': 'warn',
      'vue/no-ref-as-operand': 'warn',
      'no-useless-escape': 'warn',
      'no-empty': 'warn',
      'no-useless-assignment': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',

      // TypeScript compiler handles undefined checks better than ESLint
      'no-undef': 'off',

      // Vue: relax formatting rules that would require massive reformatting
      // (existing codebase, not greenfield — enforce via Prettier instead)
      'vue/first-attribute-linebreak': 'off',
      'vue/attributes-order': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/attribute-hyphenation': 'off',
      'vue/v-on-event-hyphenation': 'off',
    },
  },

  // Prettier must be last — disables all conflicting rules
  prettier,
)
