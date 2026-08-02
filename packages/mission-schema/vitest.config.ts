import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "mission-schema",
    include: ["test/**/*.test.ts"]
  }
});
