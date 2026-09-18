export interface ParsedTestRouteSelection {
  provider: string;
  model: string;
}

export interface TestConversationEntryLike {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: unknown;
  pending?: boolean;
  kind?: 'error';
  requestedModel?: string;
  routeModel?: string;
}

export function parseTestRouteSelection(value: string | undefined): ParsedTestRouteSelection | null {
  const selection = String(value ?? '').trim();
  const slashIndex = selection.indexOf('/');
  if (!selection || slashIndex <= 0 || slashIndex === selection.length - 1) {
    return null;
  }

  return {
    provider: selection.slice(0, slashIndex),
    model: selection.slice(slashIndex + 1),
  };
}

export function shouldResetTestConversationForSelectionChange(
  previousSelection: string | undefined,
  nextSelection: string | undefined,
): boolean {
  const previous = parseTestRouteSelection(previousSelection);
  const next = parseTestRouteSelection(nextSelection);

  if (!previous || !next) {
    return false;
  }

  return previous.provider !== next.provider || previous.model !== next.model;
}

export function formatTestThreadResetNotice(
  previousSelection: string | undefined,
  nextSelection: string | undefined,
): string {
  const previous = parseTestRouteSelection(previousSelection);
  const next = parseTestRouteSelection(nextSelection);

  if (!previous || !next) {
    return 'Thread reset after switching the active test route.';
  }

  return `Thread reset after switching from ${previous.provider} / ${previous.model} to ${next.provider} / ${next.model}.`;
}

export function buildTestConversationMessages(
  entries: TestConversationEntryLike[],
): Array<{ role: TestConversationEntryLike['role']; content: unknown }> {
  return entries
    .filter((entry) => !entry.pending)
    .map((entry) => ({
      role: entry.role,
      content: entry.content,
    }));
}

export function formatTestConversationEntryLabel(entry: TestConversationEntryLike): string {
  const routeModel = entry.routeModel ?? entry.requestedModel ?? 'unknown';

  if (entry.kind === 'error') {
    return `error ← ${routeModel}`;
  }

  if (entry.role === 'assistant') {
    return `assistant ← ${routeModel}`;
  }

  if (entry.role === 'user') {
    return `user → ${entry.requestedModel ?? routeModel}`;
  }

  return `${entry.role} → ${routeModel}`;
}
