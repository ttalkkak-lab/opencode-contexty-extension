declare module 'bun:test' {
	type TestCallback = (...args: unknown[]) => unknown;

	export const describe: (name: string, fn: TestCallback) => void;
	export const test: (name: string, fn: TestCallback) => void;
	export const expect: (value: unknown) => unknown;
	export const mock: {
		(fn?: TestCallback): TestCallback;
		module(id: string, factory: () => unknown): void;
	};
	export const beforeAll: (fn: TestCallback) => void;
	export const beforeEach: (fn: TestCallback) => void;
	export const afterEach: (fn: TestCallback) => void;
	export const afterAll: (fn: TestCallback) => void;
}
