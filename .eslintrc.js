module.exports = {
  env: {
    es2021: true,
    node: true
  },
  extends: ["eslint:recommended", "prettier"],
  overrides: [
    {
      files: ["**/*.+(ts|tsx)"],
      parser: "@typescript-eslint/parser",
      extends: [
        "plugin:@typescript-eslint/recommended",
        "plugin:@typescript-eslint/recommended-requiring-type-checking"
      ]
    }
  ],
  parserOptions: {
    ecmaVersion: "latest",
    project: true,
    sourceType: "module",
    tsconfigRootDir: __dirname
  },
  plugins: ["@typescript-eslint"],
  root: true,
  rules: {
    "linebreak-style": ["error", "unix"],
    quotes: ["error", "double", { avoidEscape: true }],
    semi: ["error", "always"]
  }
};
