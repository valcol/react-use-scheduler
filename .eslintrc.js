module.exports = {
  plugins: ["prettier"],
  env: {
    browser: true,
    node: true,
  },
  extends: ["airbnb-base", "prettier"],
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
