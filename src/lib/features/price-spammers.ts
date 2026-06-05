import browser from 'webextension-polyfill';

const STORAGE_KEY = 'priceSpammers';
const STORE_LINK_SELECTOR = 'a[href*="/store/"]';
const CARD_SELECTOR = '#card-list > *';
const SPAMMER_BORDER = '3px solid #ff7a00';
const SPAMMER_COLOR = '#ff7a00';

let stopObserving: (() => void) | null = null;
let active = false;
let spammersList: string[] = [];
let processedStoreIds = new Set<string>();
let menuEl: HTMLElement | null = null;
let menuCloseHandler: ((e: MouseEvent) => void) | null = null;

async function loadSpammers(): Promise<string[]> {
  const result = await browser.storage.sync.get([STORAGE_KEY]);
  return (result[STORAGE_KEY] as string[]) || [];
}

function extractStoreIdFromLink(link: HTMLAnchorElement): string | null {
  const match = link.href.match(/\/store\/(\d+)/);
  return match ? match[1] : null;
}

function isSpammer(storeId: string): boolean {
  return spammersList.includes(storeId);
}

function setSpammerBorder(
  el: HTMLElement,
  enable: boolean,
  isPdp: boolean,
): void {
  // PDP: apply border to the store info section
  // Card: apply border to the card container
  if (enable) {
    el.style.border = SPAMMER_BORDER;
    if (isPdp) {
      el.style.padding = '4px';
      el.style.borderRadius = '4px';
    }
  } else {
    el.style.border = '';
    if (isPdp) {
      el.style.padding = '';
      el.style.borderRadius = '';
    }
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
    `top:${event.clientY}px`,
  ].join(';');

  const item = document.createElement('div');
  item.style.cssText = 'padding:8px 16px;color:#333;';
  item.textContent = isSpam
    ? 'Remove from price spammers'
    : 'Add to price spammers';

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

/** Walk up from a store link to find a suitable container for border */
function findCardContainer(storeLink: HTMLElement): HTMLElement | null {
  let el = storeLink.parentElement;
  for (let i = 0; i < 8 && el; i++) {
    if (!el) break;
    const tag = el.tagName;
    if (tag === 'ARTICLE' || tag === 'SECTION' || tag === 'LI') return el;
    if (el.classList.length > 0) {
      const cls = Array.from(el.classList).join(' ');
      if (cls.includes('action--wrap') || cls.includes('card') || cls.includes('item') || cls.includes('product')) return el;
    }
    if (el.id && (el.id.includes('card') || el.id.includes('store'))) return el;
    el = el.parentElement;
  }
  return null;
}

/** Check if the store link is on a product detail page (sidebar/product info area) */
function isOnPdp(storeLink: HTMLElement): boolean {
  return !!storeLink.closest('[class*="product"], [class*="Product"], [id*="product"], [id*="Product"]');
}

/** Process a single store link element */
function findBestStoreLink(): HTMLAnchorElement | null {
  const links = document.querySelectorAll<HTMLAnchorElement>(STORE_LINK_SELECTOR);
  if (links.length === 0) return null;

  // Prefer the link in the sidebar (action area with price/buy buttons)
  for (const link of links) {
    if (link.closest('[class*="action--"], [class*="pdp-body-top-right"]')) return link;
  }

  // Fallback to the first link found
  return links[0];
}

function processStoreLink(storeLink: HTMLAnchorElement): void {
  const storeId = extractStoreIdFromLink(storeLink);
  if (!storeId) return;

  const isPdp = isOnPdp(storeLink);
  const spammer = isSpammer(storeId);

  // Mark all links with this store ID as processed to avoid duplicates
  document.querySelectorAll<HTMLAnchorElement>(STORE_LINK_SELECTOR).forEach((link) => {
    const id = extractStoreIdFromLink(link);
    if (id === storeId) link.setAttribute('data-ba-processed', '1');
  });

  // Insert Store ID display right after the best link
  const storeIdEl = document.createElement('span');
  storeIdEl.className = 'ba-store-id';
  storeIdEl.textContent = ` [Store ID: ${storeId}]`;
  storeIdEl.style.cssText = [
    'font-size:11px',
    'cursor:pointer',
    'margin-left:4px',
  ].join(';');

  if (spammer) setSpammerColor(storeIdEl, true);

  storeIdEl.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    showMenu(e, storeId);
  });

  storeLink.parentElement?.insertBefore(storeIdEl, storeLink.nextSibling);

  // Walk up to find container and apply border
  const container = findCardContainer(storeLink);
  if (container) {
    container.setAttribute('data-ba-store-id', storeId);
    container.setAttribute('data-ba-pdp', isPdp ? '1' : '0');
    if (spammer) setSpammerBorder(container, true, isPdp);
  }
}

/** Process #card-list cards (legacy path for when cards have store links) */
function processCard(card: HTMLElement): void {
  if (card.hasAttribute('data-ba-store-id')) return;

  const storeLink = card.querySelector<HTMLAnchorElement>(STORE_LINK_SELECTOR);
  if (!storeLink) return;

  const storeId = extractStoreIdFromLink(storeLink);
  if (!storeId) return;

  card.setAttribute('data-ba-store-id', storeId);
  card.setAttribute('data-ba-pdp', '0');
  const spammer = isSpammer(storeId);

  // Insert Store ID after image
  const img = card.querySelector('img');
  if (img) {
    const imgContainer = img.closest('a') || img.parentElement;
    if (imgContainer && imgContainer.parentElement) {
      const storeIdEl = document.createElement('div');
      storeIdEl.className = 'ba-store-id';
      storeIdEl.textContent = `Store ID: ${storeId}`;
      storeIdEl.style.cssText = 'font-size:11px;padding:2px 4px;cursor:pointer;';
      if (spammer) setSpammerColor(storeIdEl, true);
      storeIdEl.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        showMenu(e, storeId);
      });
      imgContainer.parentElement.insertBefore(storeIdEl, imgContainer.nextSibling);
    }
  }

  // Add control next to store link
  if (storeLink.parentElement) {
    const control = document.createElement('span');
    control.className = 'ba-store-control';
    control.textContent = ` [${storeId}]`;
    control.style.cssText = 'cursor:pointer;font-size:11px;';
    if (spammer) setSpammerColor(control, true);
    control.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      showMenu(e, storeId);
    });
    storeLink.parentElement.insertBefore(control, storeLink.nextSibling);
  }

  if (spammer) setSpammerBorder(card, true, false);
}

function updateAllCards(): void {
  const containers = document.querySelectorAll<HTMLElement>('[data-ba-store-id]');
  containers.forEach((container) => {
    const storeId = container.getAttribute('data-ba-store-id');
    const isPdp = container.getAttribute('data-ba-pdp') === '1';
    if (!storeId) return;
    const spammer = isSpammer(storeId);
    setSpammerBorder(container, spammer, isPdp);
  });

  const storeIdEls = document.querySelectorAll<HTMLElement>('.ba-store-id, .ba-store-control');
  storeIdEls.forEach((el) => {
    const text = el.textContent || '';
    const match = text.match(/(\d+)/);
    if (match) setSpammerColor(el, isSpammer(match[1]));
  });
}

function onStorageChanged(
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  areaName: string,
): void {
  if (areaName === 'sync' && changes[STORAGE_KEY]) {
    spammersList = (changes[STORAGE_KEY].newValue as string[]) || [];
    updateAllCards();
  }
}

/** Primary init: observe store links + card-list */
export async function initialize(): Promise<void> {
  if (active) return;
  active = true;

  spammersList = await loadSpammers();
  if (!active) return;

  // Process store links (find the best one)
  const bestLink = findBestStoreLink();
  if (bestLink) processStoreLink(bestLink);

  // Process existing #card-list cards
  const existingCards = document.querySelectorAll<HTMLElement>(CARD_SELECTOR);
  existingCards.forEach((card) => processCard(card));

  // Observe for new store links AND new cards
  const observer = new MutationObserver(() => {
    const unprocessed = document.querySelectorAll<HTMLAnchorElement>(
      `${STORE_LINK_SELECTOR}:not([data-ba-processed])`,
    );
    if (unprocessed.length > 0) {
      const best = findBestStoreLink();
      if (best && best.getAttribute('data-ba-processed') !== '1') {
        processStoreLink(best);
      }
    }

    const cards = document.querySelectorAll<HTMLElement>(CARD_SELECTOR);
    cards.forEach((card) => processCard(card));
  });

  observer.observe(document.body, { childList: true, subtree: true });

  stopObserving = () => {
    observer.disconnect();
  };

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

  document.querySelectorAll('.ba-store-id, .ba-store-control').forEach((el) => el.remove());
  document.querySelectorAll('[data-ba-store-id]').forEach((el) => {
    const isPdp = el.getAttribute('data-ba-pdp') === '1';
    if (isPdp) {
      (el as HTMLElement).style.border = '';
      (el as HTMLElement).style.padding = '';
      (el as HTMLElement).style.borderRadius = '';
    } else {
      (el as HTMLElement).style.border = '';
    }
    el.removeAttribute('data-ba-store-id');
    el.removeAttribute('data-ba-pdp');
  });

  processedStoreIds.clear();
  removeMenu();
}
