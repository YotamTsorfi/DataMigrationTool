module.exports = {
  root: true,
  parser: "@typescript-eslint/parser", // Specifies the ESLint parser for TypeScript
  extends: [
    "eslint:recommended", // ESLint's recommended rules
    "plugin:@typescript-eslint/recommended", // TypeScript-specific recommended rules
  ],
  plugins: ["@typescript-eslint"],
  env: {
    node: true, // For Node.js environment
    jest: true, // For Jest test files
  },
  rules: {
    // Custom rules and overrides
    "no-console": "off", // Allow console.log etc. since you use it extensively in your code
    "no-unused-vars": "off", // Disable base rule (TypeScript handles this)
    "@typescript-eslint/no-unused-vars": [
      "warn",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      },
    ],
    "@typescript-eslint/explicit-function-return-type": "off", // Not requiring explicit return types
    "@typescript-eslint/no-explicit-any": "off", // Allow usage of 'any' (you use it in your code)
    "@typescript-eslint/no-non-null-assertion": "off", // Allow non-null assertions (!) since you use them
  },
  overrides: [
    {
      // Apply TypeScript rules only to TypeScript files
      files: ["**/*.ts", "**/*.tsx"],
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
        project: "./tsconfig.json",
      },
    },
  ],
};
