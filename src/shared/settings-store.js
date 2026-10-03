import { DEFAULT_SETTINGS } from './constants.js';

export const settingsStore = {
  async get() {
    const value = await browser.storage.local.get(DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS, ...value };
  },
  async patch(changes) {
    await browser.storage.local.set(changes);
  },
};

