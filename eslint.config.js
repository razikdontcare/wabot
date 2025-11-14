import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
    js.configs.recommended,
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                project: './tsconfig.json',
            },
            globals: {
                // Node.js globals
                process: 'readonly',
                console: 'readonly',
                Buffer: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                URL: 'readonly',
                fetch: 'readonly',
                AbortController: 'readonly',
                TextEncoder: 'readonly',
                ReadableStream: 'readonly',
                Response: 'readonly',
                NodeJS: 'readonly',
            },
        },
        plugins: {
            '@typescript-eslint': tseslint,
        },
        rules: {
            ...tseslint.configs.recommended.rules,
            'no-console': 'off',
            'no-undef': 'off', // TypeScript handles this
            'import/extensions': 'off',
            'no-underscore-dangle': 'off',
            'class-methods-use-this': 'off',
            'max-len': ['error', {
                code: 200,
                ignoreStrings: true,
                ignoreTemplateLiterals: true,
                ignoreRegExpLiterals: true
            }],
            'no-plusplus': 'off',
            '@typescript-eslint/no-unused-vars': 'warn',
        },
    },
];
