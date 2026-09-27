import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["lib/**/*.test.ts", "tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          // Rendered form components (Testing Library + jsdom); the repository is mocked.
          name: "components",
          environment: "jsdom",
          include: ["tests/components/**/*.test.tsx"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          // Shares one local Supabase instance: run files one after another.
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
