import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "runtime-provider",
    include: ["test/**/*.test.ts"]
  }
});
