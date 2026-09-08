/**
 * UserPromptSubmit hook: injects .claude/skill-routing.md as context on every
 * prompt, so the right skills are considered for the task at hand.
 *
 * Re-injected each turn rather than left to CLAUDE.md, which does not survive
 * compaction. Silent no-op if the table is missing — a hook that fails must
 * never block a prompt.
 */
const fs = require('fs');
const path = require('path');

const root = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');
const table = path.join(root, '.claude', 'skill-routing.md');

try {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: fs.readFileSync(table, 'utf8'),
    },
  }));
} catch {
  /* no table, nothing to inject */
}
