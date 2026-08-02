import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "root",
          include: ["tests/**/*.vitest.test.{ts,js}"]
        }
      },
      "apps/*",
      "packages/*",
      "providers/*",
      "trials/*/*"
    ]
  }
});
