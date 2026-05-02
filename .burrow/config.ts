import { readFileSync } from "fs";
import { join } from "path";
import { Burrow, claudeCode, docker } from "../src/index.ts";

const systemPrompt = readFileSync(
  join(import.meta.dir, "system-prompt.md"),
  "utf-8"
);

export default new Burrow({
  agent: claudeCode("claude-opus-4-7", { permissionMode: "acceptEdits" }),
  sandbox: docker({
    imageName: "burrow:local",
  }),
  cwd: join(import.meta.dir, ".."),
  systemPrompt,
  git: {
    branchPattern: "feature/<slug>",
    commitStyle: "conventional",
  },
});
