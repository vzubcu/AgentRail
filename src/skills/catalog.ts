export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  /** URL an AI client can use to load/install the skill. */
  url: string;
  /** Which AI clients this skill is compatible with. */
  clients: string[];
  category: string;
}

const SKILLS: AgentSkill[] = [
  {
    id: 'backend-patterns',
    name: 'Backend Patterns',
    description: 'Backend architecture patterns, API design, database optimization, and server-side best practices for Node.js, Express, and Next.js API routes.',
    url: 'agentrail://skills/backend-patterns',
    clients: ['claude', 'codex', 'cline', 'roo', 'kilo'],
    category: 'architecture',
  },
  {
    id: 'frontend-patterns',
    name: 'Frontend Patterns',
    description: 'Frontend development patterns for React, Next.js, state management, performance optimization, and UI best practices.',
    url: 'agentrail://skills/frontend-patterns',
    clients: ['claude', 'codex', 'cline', 'roo', 'kilo'],
    category: 'frontend',
  },
  {
    id: 'security-review',
    name: 'Security Review',
    description: 'Security checklist and patterns for authentication, user input handling, secrets, API endpoints, and payment/sensitive features.',
    url: 'agentrail://skills/security-review',
    clients: ['claude', 'codex', 'cline', 'roo', 'kilo'],
    category: 'security',
  },
  {
    id: 'fullstack-developer',
    name: 'Fullstack Developer',
    description: 'Modern web development expertise covering React, Node.js, databases, and full-stack architecture.',
    url: 'agentrail://skills/fullstack-developer',
    clients: ['claude', 'codex', 'cline', 'roo', 'kilo'],
    category: 'architecture',
  },
  {
    id: 'project-memory-scout',
    name: 'Project Memory Scout',
    description: 'Create or refresh portable AI memory files (AGENTS.md/CLAUDE.md/GEMINI.md) for a software project.',
    url: 'agentrail://skills/project-memory-scout',
    clients: ['claude', 'codex', 'cline', 'roo', 'kilo'],
    category: 'tooling',
  },
  {
    id: 'search-first',
    name: 'Search First',
    description: 'Research-before-coding workflow. Search for existing tools, libraries, and patterns before writing custom code.',
    url: 'agentrail://skills/search-first',
    clients: ['claude', 'codex', 'cline', 'roo', 'kilo'],
    category: 'workflow',
  },
  {
    id: 'skill-creator',
    name: 'Skill Creator',
    description: 'Create new skills, modify and improve existing skills, and measure skill performance.',
    url: 'agentrail://skills/skill-creator',
    clients: ['claude', 'codex', 'cline', 'roo', 'kilo'],
    category: 'tooling',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    description: 'Supabase products: Database, Auth, Edge Functions, Realtime, Storage, Vectors. Client libraries and SSR integrations.',
    url: 'agentrail://skills/supabase',
    clients: ['claude', 'codex', 'cline', 'roo', 'kilo'],
    category: 'backend',
  },
  {
    id: 'telegram-bot-builder',
    name: 'Telegram Bot Builder',
    description: 'Expert in building Telegram bots that solve real problems — from simple automation to complex AI-powered bots.',
    url: 'agentrail://skills/telegram-bot-builder',
    clients: ['claude', 'codex', 'cline', 'roo', 'kilo'],
    category: 'messaging',
  },
  {
    id: 'telegram-mini-app',
    name: 'Telegram Mini App',
    description: 'Expert in building Telegram Mini Apps (TWA) — web apps that run inside Telegram with native-like experience.',
    url: 'agentrail://skills/telegram-mini-app',
    clients: ['claude', 'codex', 'cline', 'roo', 'kilo'],
    category: 'messaging',
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    description: 'Search, scrape, and interact with the web via the Firecrawl CLI. Real-time web search with full page content.',
    url: 'agentrail://skills/firecrawl',
    clients: ['claude', 'codex', 'cline', 'roo', 'kilo'],
    category: 'web',
  },
  {
    id: 'frontend-design',
    name: 'Frontend Design',
    description: 'Create distinctive, production-grade frontend interfaces with high design quality.',
    url: 'agentrail://skills/frontend-design',
    clients: ['claude', 'codex', 'cline', 'roo', 'kilo'],
    category: 'frontend',
  },
];

export function listSkills(): AgentSkill[] {
  return SKILLS;
}

export function getSkillUrl(id: string): string | undefined {
  return SKILLS.find((s) => s.id === id)?.url;
}