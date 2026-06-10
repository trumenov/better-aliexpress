import './reset.css';
import './style.css';
import { ConfigStore } from '../lib/config/config-store.ts';
import browser from 'webextension-polyfill';
import { features } from '../lib/features/features.ts';
import { ToggleFeatureMessage } from '../lib/messages/toggle-feature-message.ts';
import { MessageTypes } from '../lib/messages/message-types.ts';
import { manifest } from '../manifest.ts';
import { FeatureKey } from '../lib/features/feature-key.ts';

async function sendFeatureToggleMessage(featureKey: FeatureKey, active: boolean) {
  const message: ToggleFeatureMessage = {
    type: MessageTypes.ToggleFeature,
    featureKey: featureKey,
    active: active
  };

  const contentScriptUrls = manifest.content_scripts![0].matches;

  try {
    const tabs = await browser.tabs.query({ url: contentScriptUrls, active: true });

    for (const tab of tabs) {
      await browser.tabs.sendMessage(tab.id!, message);
    }
  } catch (ex) {
    //TODO
  }
}

async function renderConfig() {
  const configStore = ConfigStore.getInstance();
  await configStore.load();

  const configContainer = document.getElementById('configContainer');
  if (!configContainer) return;

  const configs = configStore.getState();

  for (const feature of features) {
    const featureElement = document.createElement('div');
    featureElement.classList.add('feature');

    const toggleElement = document.createElement('input');
    toggleElement.type = 'checkbox';
    toggleElement.name = feature.key;
    toggleElement.id = feature.key;
    toggleElement.addEventListener('change', async (event) => {
      const target = event.target as HTMLInputElement;

      await configStore.save(feature.key, target.checked);
      await sendFeatureToggleMessage(feature.key, target.checked);
    });
    const featureActive = configs.find((config) => config.featureKey === feature.key)?.active;
    toggleElement.checked = featureActive ?? false;
    await sendFeatureToggleMessage(feature.key, featureActive ?? false);

    const labelElement = document.createElement('label');
    labelElement.htmlFor = feature.key;
    labelElement.textContent = feature.label;

    featureElement.appendChild(toggleElement);
    featureElement.appendChild(labelElement);

    configContainer.appendChild(featureElement);
  }
}

const EXPORTER_ENDPOINT_KEY = 'priceExporterEndpoint';

async function renderExporterSettings() {
  const section = document.getElementById('exporterSettings');
  if (!section) return;

  const input = document.getElementById('exporterEndpoint') as HTMLInputElement | null;
  const saveBtn = document.getElementById('exporterSaveBtn');
  const statusEl = document.getElementById('exporterSaveStatus');
  if (!input || !saveBtn || !statusEl) return;

  const result = await browser.storage.sync.get([EXPORTER_ENDPOINT_KEY]);
  input.value = (result[EXPORTER_ENDPOINT_KEY] as string) || '';

  saveBtn.addEventListener('click', async () => {
    const url = input.value.trim();
    if (url && !/^https?:\/\/.+/.test(url)) {
      statusEl.textContent = 'Invalid URL';
      statusEl.style.color = '#c62828';
      setTimeout(() => {
        statusEl.textContent = '';
        statusEl.style.color = '';
      }, 2000);
      return;
    }
    await browser.storage.sync.set({ [EXPORTER_ENDPOINT_KEY]: url });
    statusEl.textContent = '✓ Saved';
    setTimeout(() => {
      statusEl.textContent = '';
    }, 2000);
  });
}

await renderConfig();
await renderExporterSettings();
