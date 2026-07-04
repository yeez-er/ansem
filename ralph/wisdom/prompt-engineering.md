# Prompt Engineering Wisdom

<!-- Patterns for writing effective agent prompts in headless `claude -p` mode -->

- `<HARD-GATE>` XML tags create stronger enforcement than markdown headers, bold text, or caps lock. Agents treat markdown emphasis as suggestions but treat XML tags as structural boundaries. Use for absolute non-negotiable rules only — overuse dilutes the signal. [from: superpowers]
- The single-sentence meta-rule "Violating the letter of this rule IS violating the spirit of this rule" closes an entire class of rationalization. Without it, agents find "technically compliant" workarounds. Add this sentence after every iron law / hard gate. [from: superpowers]
- Description Trap: If a prompt's opening lines summarize the workflow ("You are a build agent that reads the plan, writes tests, implements code, and commits"), Claude may treat the summary as the full instruction and shortcut the detailed body. Mitigation: start prompts with constraints and context, not summaries. Put the workflow description AFTER the rules. [from: superpowers]
- When porting enforcement rules between systems, port the RATIONALIZATION TABLE alongside the rule. The rule says "don't do X." The table says "here are 12 ways you'll convince yourself X is OK, and why each is wrong." The table is more valuable than the rule — it closes the escape hatches the rule leaves open. [from: superpowers]
- Prompts that say "NEVER do X" get violated less often when paired with an explicit "if you catch yourself doing X, STOP and do Y instead" recovery instruction. Prohibition alone creates pressure to rationalize; prohibition + recovery gives the agent a concrete alternative path. [from: superpowers]
- Subagent prompt templates with `{{VARIABLE}}` placeholders allow structured dispatch — orchestrator fills variables, subagent inherits focused context without reading the full plan. Store templates in `ralph/subagents/`. [from: superpowers]
