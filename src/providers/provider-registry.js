import { genericLmsProvider } from './generic-lms.provider.js';
import { pttc1Provider } from './pttc1.provider.js';

// Thêm provider riêng (Moodle, Canvas...) vào đây; không trộn selector LMS vào content script.
const providers = [pttc1Provider, genericLmsProvider];

export function resolveProvider(location) {
  return providers.find((provider) => provider.matches(location)) ?? null;
}

