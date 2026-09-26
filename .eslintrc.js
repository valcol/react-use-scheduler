module.exports = {
  env: {
    browser: true,
    node: true,
  },
  plugins: ["prettier", "react-hooks"],
  extends: ["airbnb-base", "plugin:react-hooks/recommended", "prettier"],
  overrides: [
    {
      files: ["*.test.js"],
      plugins: ["jest"],
      extends: ["plugin:jest/recommended"],
    },
  ],
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: "module",
  },
};
