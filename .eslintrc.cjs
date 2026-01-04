module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'script',
  },
  ignorePatterns: ['node_modules/', 'dist/', 'example/dist/'],
  overrides: [
    {
      files: ['test/**/*.js'],
      env: {
        mocha: true,
        node: true,
      },
    },
    {
      files: ['example/src/**/*.js'],
      env: {
        browser: true,
        es2022: true,
      },
      parserOptions: {
        sourceType: 'module',
      },
    },
    {
      files: ['example/vite.config.js'],
      env: {
        node: true,
      },
    },
  ],
};
