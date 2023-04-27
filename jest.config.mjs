export default {
  transform: { "\\.(ts)$": "ts-jest", "\\.(tsx)$": "ts-jest" },
  testEnvironment: "node",
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  // .js always uses the module type of the nearest package.json
  extensionsToTreatAsEsm: [".ts", ".tsx"],
  // This allows tests use .js extensions in imports from tests.
  // We could import paths without extensions in tests, but from
  // library code it's important to use .js import paths because
  // TypeScript won't change them, and published ESM code needs
  // to use .js file extensions.
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    // Workaround from https://github.com/facebook/jest/issues/12270#issuecomment-1034792989
    "#ansi-styles": "chalk/source/vendor/ansi-styles/index.js",
    "#supports-color": "chalk/source/vendor/supports-color/index.js",
  },
  globals: {
    "ts-jest": {
      useESM: true,
    },
  },
};
