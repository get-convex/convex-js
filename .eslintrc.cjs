module.exports = {
  // means don't look to parent dir, so use `root: true` in descendant directories to ignore this config
  // See https://eslint.org/docs/user-guide/configuring/configuration-files#cascading-and-hierarchy
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["./tsconfig.json", "./src/cli/tsconfig.json"],
    tsconfigRootDir: __dirname,
  },
  plugins: ["@typescript-eslint", "react-hooks", "react"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],
  env: {
    amd: true,
    browser: true,
    jest: true,
    node: true,
  },
  rules: {
    "no-debugger": "error",
    // any is terrible but we use it a lot (even in our public code).
    "@typescript-eslint/no-explicit-any": "off",

    // asserting that values aren't null is risky but useful.
    "@typescript-eslint/no-non-null-assertion": "off",

    // allow (_arg: number) => {}
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      },
    ],

    // Add React hooks rules so we don't misuse them.
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",
    // From https://github.com/typescript-eslint/typescript-eslint/issues/1391#issuecomment-1124154589
    // Prefer `private` ts keyword to `#private` private methods
    "no-restricted-syntax": [
      "error",
      {
        selector:
          ":matches(PropertyDefinition, MethodDefinition) > PrivateIdentifier.key",
        message: "Use `private` instead",
      },
    ],
    // Makes it harder to accidentally fire off a promise without waiting for it.
    "@typescript-eslint/no-floating-promises": "error",
    // Since `const x = <number>foo;` syntax is ambiguous with JSX syntax some tools don't support it.
    // In particular we need this for depcheck https://github.com/depcheck/depcheck/issues/585
    "@typescript-eslint/consistent-type-assertions": [
      "error",
      {
        assertionStyle: "as",
      },
    ],
    eqeqeq: ["error", "always"],
  },
  ignorePatterns: ["node_modules", "dist", "*.js"],
};
