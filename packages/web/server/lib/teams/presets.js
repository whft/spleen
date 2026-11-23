export const TEAM_PRESETS = Object.freeze({
  'full-stack': [
    { name: 'Lead', role: 'lead', description: 'Coordinates architecture, task breakdown, and integration across members.' },
    { name: 'Backend', role: 'backend', description: 'Implements APIs, storage, server logic, and backend tests.' },
    { name: 'Frontend', role: 'frontend', description: 'Implements UI components, stores, styling, and UX polish.' },
    { name: 'QA', role: 'qa', description: 'Verifies edge cases, writes integration tests, and audits regressions.' },
  ],
  'research-build': [
    { name: 'Lead', role: 'lead', description: 'Synthesizes findings and directs implementation.' },
    { name: 'Researcher', role: 'researcher', description: 'Explores the codebase, APIs, and constraints.' },
    { name: 'Builder', role: 'builder', description: 'Applies focused code changes cleanly.' },
    { name: 'Verifier', role: 'verifier', description: 'Runs test suites, type-checks, and validates behavior.' },
  ],
  'autonomous-lab': [
    { name: 'Supervisor', role: 'supervisor', description: 'Decomposes objectives, manages priorities, budgets, replanning, and delegation.' },
    { name: 'Researcher', role: 'researcher', description: 'Discovers sources, retrieves cited documentation, and resolves contradictions.' },
    { name: 'Code Analyst', role: 'code-analyst', description: 'Maps codebase architecture, invariants, and change impact.' },
    { name: 'Static Analyst', role: 'static-analyst', description: 'Interprets authorized static-analysis exports with strict build provenance.' },
    { name: 'Engineer', role: 'engineer', description: 'Implements maintainable code fixes and features in isolated worktrees.' },
    { name: 'Tester', role: 'tester', description: 'Writes and runs automated unit, integration, and regression tests.' },
    { name: 'Validator', role: 'validator', description: 'Independently verifies acceptance criteria, diffs, and build evidence.' },
    { name: 'Memory Curator', role: 'memory-curator', description: 'Consolidates verified discoveries, flags stale claims, and tests procedural skills.' },
  ],
  'bug-hunt': [
    { name: 'Lead', role: 'lead', description: 'Coordinates reproduction and sign-off.' },
    { name: 'Investigator', role: 'investigator', description: 'Traces logs, stack frames, and root causes.' },
    { name: 'Fixer', role: 'fixer', description: 'Implements minimal safe fixes.' },
    { name: 'Reviewer', role: 'reviewer', description: 'Audits diffs and tests for regressions.' },
  ],
  'multi-review': [
    { name: 'Lead', role: 'lead', description: 'Aggregates audit reports into an actionable summary.' },
    { name: 'Security', role: 'security', description: 'Audits auth, input validation, path/SSRF safety, and secrets.' },
    { name: 'Performance', role: 'performance', description: 'Finds bottlenecks, leaks, and unnecessary I/O.' },
    { name: 'Correctness', role: 'correctness', description: 'Checks edge cases, error handling, and test coverage.' },
  ],
  custom: [
    { name: 'Lead', role: 'lead', description: 'Orchestrates custom team members and shared tasks.' },
  ],
});
