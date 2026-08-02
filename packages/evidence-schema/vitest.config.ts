import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "evidence-schema",
    include: ["test/**/*.test.ts"]
  }
});
