import browser from 'webextension-polyfill';
import { observeElements } from '../utils.ts';

const STORAGE_KEY = 'priceSpammers';
const CARD_SELECTOR = '#card-list > *';
const SPAMMER_BORDER = '3px solid #ff7a00';
const SPAMMER_COLOR = '#ff7a00';

let stopObserving: (() => void) | null = null;
let active = false;
let spammersList: string[] = [];
let processedCards = new WeakSet<HTMLElement>();
let menuEl: HTMLElement | null = null;
let menuCloseHandler: ((e: MouseEvent) => void) | null = null;

async function loadSpammers(): Promise<string[]> {
  const result = await browser.storage.sync.get([STORAGE_KEY]);
  return (result[STORAGE_KEY] as string[]) || [];
}

function extractStoreId(card: HTMLElement): string | null {
  const storeLink = card.querySelector<HTMLAnchorElement>('a[href*="/store/"]');
  if (storeLink) {
    const match = storeLink.href.match(/\/store\/(\d+)/);
    if (match) return match[1];
  }

  const dataEl = card.querySelector('[data-store-id], [data-shop-id]');
  if (dataEl) {
    const val = dataEl.getAttribute('data-store-id') || dataEl.getAttribute('data-shop-id');
    if (val && /^\d+$/.test(val)) return val;
  }

  const allLinks = card.querySelectorAll<HTMLAnchorElement>('a');
  for (const link of allLinks) {
    const match = link.href.match(/\/store\/(\d+)/);
    if (match) return match[1];
  }

  return null;
}

function isSpammer(storeId: string): boolean {
  return spammersList.includes(storeId);
}

function setSpammerBorder(card: HTMLElement, enable: boolean): void {
  if (enable) {
    card.style.border = SPAMMER_BORDER;
  } else {
    card.style.border = '';
  }
}

function setSpammerColor(el: HTMLElement, enable: boolean): void {
  if (enable) {
    el.style.color = SPAMMER_COLOR;
    el.style.fontWeight = 'bold';
  } else {
    el.style.color = '';
    el.style.fontWeight = '';
  }
}

function showMenu(event: MouseEvent, storeId: string): void {
  removeMenu();

  const isSpam = isSpammer(storeId);

  const menu = document.createElement('div');
  menu.style.cssText = [
    'position:fixed',
    'z-index:999999',
    'background:#fff',
    'border:1px solid #ccc',
    'box-shadow:0 2px 8px rgba(0,0,0,0.2)',
    'border-radius:4px',
    'padding:4px 0',
    'font-size:13px',
    'min-width:200px',
    'cursor:pointer',
    `left:${event.clientX}px`,
    `top:${event.clientY}px`
  ].join(';');

  const item = document.createElement('div');
  item.style.cssText = 'padding:8px 16px;color:#333;';
  item.textContent = isSpam ? 'Remove from price spammers' : 'Add to price spammers';

  item.addEventListener('mouseenter', () => {
    item.style.backgroundColor = '#f5f5f5';
  });
  item.addEventListener('mouseleave', () => {
    item.style.backgroundColor = '';
  });

  item.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();

    if (isSpam) {
      spammersList = spammersList.filter((id) => id !== storeId);
      await browser.storage.sync.set({ [STORAGE_KEY]: spammersList });
    } else {
      if (!spammersList.includes(storeId)) {
        spammersList = [...spammersList, storeId];
        await browser.storage.sync.set({ [STORAGE_KEY]: spammersList });
      }
    }

    removeMenu();
  });

  menu.appendChild(item);
  document.body.appendChild(menu);
  menuEl = menu;

  if (menuCloseHandler) {
    document.removeEventListener('click', menuCloseHandler);
  }

  menuCloseHandler = (ce: MouseEvent) => {
    if (menuEl && !menuEl.contains(ce.target as Node)) {
      removeMenu();
    }
  };
  setTimeout(() => {
    if (menuCloseHandler) {
      document.addEventListener('click', menuCloseHandler);
    }
  }, 0);
}

function removeMenu(): void {
  if (menuCloseHandler) {
    document.removeEventListener('click', menuCloseHandler);
    menuCloseHandler = null;
  }
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
}

function processCard(card: HTMLElement): void {
  if (processedCards.has(card)) return;
  processedCards.add(card);

  const storeId = extractStoreId(card);
  if (!storeId) return;

  card.setAttribute('data-ba-store-id', storeId);

  const img = card.querySelector('img');
  if (img) {
    const imgContainer = img.closest('a') || img.parentElement;
    if (imgContainer && imgContainer.parentElement) {
      const storeIdEl = document.createElement('div');
      storeIdEl.className = 'ba-store-id';
      storeIdEl.textContent = `Store ID: ${storeId}`;
      storeIdEl.style.cssText = 'font-size:11px;padding:2px 4px;cursor:pointer;';

      if (isSpammer(storeId)) {
        setSpammerColor(storeIdEl, true);
      }

      storeIdEl.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        showMenu(e, storeId);
      });

      imgContainer.parentElement.insertBefore(storeIdEl, imgContainer.nextSibling);
    }
  }

  const storeLink = card.querySelector<HTMLAnchorElement>('a[href*="/store/"]');
  if (storeLink && storeLink.parentElement) {
    const control = document.createElement('span');
    control.className = 'ba-store-control';
    control.textContent = ` [${storeId}]`;
    control.style.cssText = 'cursor:pointer;font-size:11px;';

    if (isSpammer(storeId)) {
      setSpammerColor(control, true);
    }

    control.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      showMenu(e, storeId);
    });

    storeLink.parentElement.insertBefore(control, storeLink.nextSibling);
  }

  if (isSpammer(storeId)) {
    setSpammerBorder(card, true);
  }
}

function updateCard(card: HTMLElement): void {
  const storeId = card.getAttribute('data-ba-store-id');
  if (!storeId) return;

  const isSpam = isSpammer(storeId);
  setSpammerBorder(card, isSpam);

  const storeIdEl = card.querySelector<HTMLElement>('.ba-store-id');
  if (storeIdEl) setSpammerColor(storeIdEl, isSpam);

  const control = card.querySelector<HTMLElement>('.ba-store-control');
  if (control) setSpammerColor(control, isSpam);
}

function updateAllCards(): void {
  const cards = document.querySelectorAll<HTMLElement>(`${CARD_SELECTOR}[data-ba-store-id]`);
  cards.forEach((card) => updateCard(card));
}

function onStorageChanged(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string): void {
  if (areaName === 'sync' && changes[STORAGE_KEY]) {
    spammersList = (changes[STORAGE_KEY].newValue as string[]) || [];
    updateAllCards();
  }
}

export async function initialize(): Promise<void> {
  if (active) return;
  active = true;

  spammersList = await loadSpammers();

  if (!active) return;

  const callback = (cards: HTMLElement[]) => {
    cards.forEach((card) => processCard(card));
  };

  const existing = document.querySelectorAll<HTMLElement>(CARD_SELECTOR);
  callback(Array.from(existing));

  stopObserving = observeElements(CARD_SELECTOR, callback);
  browser.storage.onChanged.addListener(onStorageChanged);
}

export function activatePriceSpammers(): void {
  if (active) return;
  initialize().catch(console.error);
}

export function disablePriceSpammers(): void {
  active = false;

  if (stopObserving) {
    stopObserving();
    stopObserving = null;
  }

  browser.storage.onChanged.removeListener(onStorageChanged);

  const cards = document.querySelectorAll<HTMLElement>(CARD_SELECTOR);
  cards.forEach((card) => {
    card.querySelector('.ba-store-id')?.remove();
    card.querySelector('.ba-store-control')?.remove();
    card.style.border = '';
    card.removeAttribute('data-ba-store-id');
  });

  processedCards = new WeakSet();
  removeMenu();
}
