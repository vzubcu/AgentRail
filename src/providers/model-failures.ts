import type { BaseProvider } from './base.js';
import { ProviderTimeoutError } from './timeout.js';

export const MODEL_TIMEOUT_THRESHOLD = 3;

export function isProviderTimeoutError(error: unknown): error is ProviderTimeoutError {
  return error instanceof ProviderTimeoutError;
}

export function isUnsupportedModelResponse(status: number, body: string): boolean {
  if (![400, 401, 404].includes(status)) {
    return false;
  }

  const text = body.toLowerCase();
  return text.includes('modelerror')
    || text.includes('model is not supported')
    || text.includes('not supported')
    || text.includes('invalid model')
    || text.includes('model_not_found')
    || text.includes('model not found')
    || (text.includes('only supports') && text.includes('interactions api'));
}

export function getConcreteRouteModel(provider: BaseProvider, requestedModel: string): string {
  const bareModelId = requestedModel.startsWith(`${provider.name}/`)
    ? requestedModel.slice(provider.name.length + 1)
    : requestedModel;
  const supportedModel = provider.supportsModel(bareModelId);
  return `${provider.name}/${supportedModel?.id ?? bareModelId}`;
}
