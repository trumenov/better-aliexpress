import browser from 'webextension-polyfill';
import { ConfigStore } from '../lib/config/config-store.ts';
import { features } from '../lib/features/features.ts';
import { MessageTypes } from '../lib/messages/message-types.ts';
import { ToggleFeatureMessage } from '../lib/messages/toggle-feature-message.ts';
import { ENDPOINT_KEY, ExportPriceDataResponse } from '../lib/messages/export-price-data-message.ts';
import type { Runtime } from 'webextension-polyfill';

browser.runtime.onInstalled.addListener(() => {
  console.log('Better AliExpress extension installed');
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url || !tab.url.includes('aliexpress.com')) {
    return;
  }

  const configStore = ConfigStore.getInstance();
  await configStore.load();
  const configs = configStore.getState();

  for (const feature of features) {
    const featureActive = configs.find((config) => config.featureKey === feature.key)?.active;

    const message: ToggleFeatureMessage = {
      type: MessageTypes.ToggleFeature,
      featureKey: feature.key,
      active: featureActive ?? false
    };

    try {
      await browser.tabs.sendMessage(tabId, message);
    } catch (ex) {
      //TODO
    }
  }
});

browser.runtime.onMessage.addListener(
  async (message: unknown, _sender: Runtime.MessageSender): Promise<ExportPriceDataResponse> => {
    const msg = message as { type?: string; data?: unknown };
    if (msg?.type !== MessageTypes.ExportPriceData) {
      return { success: false, error: 'Unknown message type' };
    }

    const result = await browser.storage.sync.get([ENDPOINT_KEY]);
    const endpoint = result[ENDPOINT_KEY] as string | undefined;

    if (!endpoint || !msg.data) {
      return { success: false, error: 'No endpoint configured' };
    }

    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg.data)
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
);

console.log('Running Better AliExpress background script');
