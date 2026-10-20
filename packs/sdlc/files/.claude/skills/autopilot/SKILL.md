---
name: autopilot
description: Build a product from one idea with persimmon and no human at any Gate - the whole SDLC run order from Prd to tested code. Runs autopilot-doc, then autopilot-code. Use when the developer says "autopilot", gives an idea to build end to end, or asks to run the whole persimmon flow unattended.
---

# Autopilot

The developer gives an idea. You take it to built, tested code with every artifact in the
persimmon store, and stop only on a failure.

1. Follow `.claude/skills/autopilot-doc/SKILL.md` with the idea. It ends with the Plans.
2. Follow `.claude/skills/autopilot-code/SKILL.md` over those Plans.
3. One report, as `.claude/skills/autopilot/driving.md` says, covering both.

If `autopilot-doc` stops, report and do not start `autopilot-code`.
