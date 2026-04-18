import typescriptEslint from "typescript-eslint";

export default [{
    files: ["**/*.ts"],
}, {
    plugins: {
        "@typescript-eslint": typescriptEslint.plugin,
    },

    languageOptions: {
        parser: typescriptEslint.parser,
        ecmaVersion: 2022,
        sourceType: "module",
    },

    rules: {
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",
    },
}, {
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.test.ts", "src/**/*.integration.test.ts", "src/integration/**"],

    rules: {
        "no-console": "error",
        "@typescript-eslint/no-explicit-any": "error",
    },
}, {
    files: ["src/**/*.test.ts", "src/**/*.integration.test.ts", "src/integration/**"],

    rules: {
        "no-console": "off",
        "@typescript-eslint/no-explicit-any": "off",
    },
}];
