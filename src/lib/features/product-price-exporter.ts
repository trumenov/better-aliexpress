import browser from 'webextension-polyfill';
import { MessageTypes } from '../messages/message-types.ts';
import { ExportPriceDataMessage, ExportPriceDataResponse } from '../messages/export-price-data-message.ts';

const STORE_LINK_SELECTOR = 'a[href*="/store/"]';

interface VariantPrice {
  name: string;
  price: string;
  skuCol: string;
}

interface ProductData {
  productId: string;
  productName: string;
  vendorId: string;
  vendorName: string;
  shippingCost: string;
  currency: string;
  variants: VariantPrice[];
  message?: string;
}

let active = false;
let observer: MutationObserver | null = null;
let messageText = '';

function extractProductId(): string | null {
  const match = window.location.pathname.match(/\/item\/(\d+)\.html/);
  return match ? match[1] : null;
}

function extractStoreInfo(): { id: string; name: string } | null {
  const links = document.querySelectorAll<HTMLAnchorElement>(STORE_LINK_SELECTOR);
  for (const link of links) {
    const idMatch = link.href.match(/\/store\/(\d+)/);
    if (idMatch) {
      const nameEl = document.querySelector('.store-info--name--E2VWTyv, .store-detail--storeName--Lk2FVZ4');
      const name = nameEl ? nameEl.textContent?.trim() || '' : link.textContent?.trim() || '';
      return { id: idMatch[1], name };
    }
  }
  return null;
}

function extractShippingCost(): string {
  const shippingEl = document.querySelector('.dynamic-shipping');
  if (shippingEl) {
    const text = shippingEl.textContent?.trim() || '';
    if (text.includes('Free shipping') || text.includes('Free Shipping')) return '0';
    const match = text.match(/US\s*\$?([\d.]+)/);
    if (match) return match[1];
  }
  return '';
}

function extractCurrency(): string {
  const priceEl = document.querySelector('.price-default--current--F8OlYIo');
  if (priceEl) {
    const text = priceEl.textContent?.trim() || '';
    const match = text.match(/US\s*\$|USD/);
    if (match) return 'USD';
  }
  return 'USD';
}

function getCurrentPrice(): string {
  const priceEl = document.querySelector('.price-default--current--F8OlYIo');
  if (priceEl) {
    const text = priceEl.textContent?.trim() || '';
    const match = text.match(/[\d.]+/);
    return match ? match[0] : '';
  }
  return '';
}

function getCurrentSkuName(): string | null {
  const selected = document.querySelector('.sku-item--selected--ITGY_EO img');
  return selected ? selected.getAttribute('alt') : null;
}

async function scrapeAllVariants(): Promise<VariantPrice[]> {
  const variants: VariantPrice[] = [];
  const skuItems = document.querySelectorAll<HTMLElement>('.sku-item--skus--StEhULs > div');

  if (skuItems.length === 0) return variants;

  const originalSku = getCurrentSkuName();

  for (const item of skuItems) {
    const img = item.querySelector('img');
    const name = img ? img.getAttribute('alt') : '';
    if (!name) continue;

    const skuCol = item.getAttribute('data-sku-col') || '';

    if (!item.classList.contains('sku-item--selected--ITGY_EO')) {
      item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 150));
    }

    const price = getCurrentPrice();
    variants.push({ name, price, skuCol });
  }

  if (originalSku) {
    const originalItem = Array.from(skuItems).find(
      (el) => el.querySelector('img')?.getAttribute('alt') === originalSku
    );
    if (originalItem) {
      originalItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  }

  return variants;
}

function getProductName(): string {
  const h1 = document.querySelector('h1');
  return h1 ? h1.textContent?.trim() || '' : '';
}

async function collectProductData(): Promise<ProductData> {
  const variants = await scrapeAllVariants();
  const store = extractStoreInfo();

  return {
    productId: extractProductId() || '',
    productName: getProductName(),
    vendorId: store?.id || '',
    vendorName: store?.name || '',
    shippingCost: extractShippingCost(),
    currency: extractCurrency(),
    variants
  };
}

async function sendToServer(data: ProductData): Promise<void> {
  const message: ExportPriceDataMessage = {
    type: MessageTypes.ExportPriceData,
    data
  };

  try {
    const response: ExportPriceDataResponse = await browser.runtime.sendMessage(message);
    if (response.success) {
      alert('Price Exporter: Data sent successfully!');
    } else {
      if (response.error?.includes('No endpoint configured')) {
        const input = prompt(
          'Price Exporter: Enter the server endpoint URL (POST JSON):',
          'http://localhost:8888/api/prices'
        );
        if (!input) return;
        await browser.storage.sync.set({ priceExporterEndpoint: input });
        const retry: ExportPriceDataResponse = await browser.runtime.sendMessage(message);
        if (retry.success) {
          alert('Price Exporter: Data sent successfully!');
        } else {
          alert(`Price Exporter: Failed to send data - ${retry.error}`);
        }
      } else {
        alert(`Price Exporter: Failed to send data - ${response.error}`);
      }
    }
  } catch (err) {
    alert(`Price Exporter: Failed to send data - ${err}`);
  }
}

function buildDefaultMessage(): string {
  const skuName = getCurrentSkuName() || '';
  const price = getCurrentPrice();
  const shipping = extractShippingCost();
  const shippingText = shipping === '0' || shipping === '' ? '' : ` + shipping $${shipping}`;
  return `${skuName} $${price}${shippingText}`.trim();
}

function injectUI(): void {
  if (document.getElementById('ba-price-exporter')) return;

  const container = document.createElement('div');
  container.id = 'ba-price-exporter';
  container.style.cssText = [
    'position:fixed',
    'bottom:20px',
    'right:20px',
    'z-index:99999',
    'display:flex',
    'flex-direction:column',
    'gap:8px'
  ].join(';');

  const sendBtn = document.createElement('button');
  sendBtn.textContent = 'Send prices to server';
  sendBtn.style.cssText = [
    'padding:10px 16px',
    'background:#ff7a00',
    'color:#fff',
    'border:none',
    'border-radius:6px',
    'cursor:pointer',
    'font-weight:bold',
    'font-size:13px',
    'box-shadow:0 2px 8px rgba(0,0,0,0.2)'
  ].join(';');
  sendBtn.addEventListener('click', async () => {
    sendBtn.textContent = 'Collecting data...';
    sendBtn.disabled = true;
    try {
      const data = await collectProductData();
      if (messageText) data.message = messageText;
      await sendToServer(data);
    } finally {
      sendBtn.textContent = 'Send prices to server';
      sendBtn.disabled = false;
    }
  });

  const msgBtn = document.createElement('button');
  msgBtn.textContent = 'Add message';
  msgBtn.style.cssText = [
    'padding:10px 16px',
    'background:#fff',
    'color:#333',
    'border:2px solid #ff7a00',
    'border-radius:6px',
    'cursor:pointer',
    'font-weight:bold',
    'font-size:13px',
    'box-shadow:0 2px 8px rgba(0,0,0,0.2)'
  ].join(';');

  msgBtn.addEventListener('click', () => {
    const defaultMsg = buildDefaultMessage();
    const input = prompt('Enter message for this product:', messageText || defaultMsg);
    if (input !== null) {
      messageText = input;
      msgBtn.textContent = messageText
        ? `Message: ${messageText.slice(0, 30)}${messageText.length > 30 ? '...' : ''}`
        : 'Add message';
    }
  });

  container.appendChild(sendBtn);
  container.appendChild(msgBtn);
  document.body.appendChild(container);
}

function removeUI(): void {
  const el = document.getElementById('ba-price-exporter');
  if (el) el.remove();
}

export function activatePriceExporter(): void {
  if (active) return;
  active = true;

  injectUI();

  observer = new MutationObserver(() => {
    if (!document.getElementById('ba-price-exporter')) {
      injectUI();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export function disablePriceExporter(): void {
  active = false;
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  removeUI();
  messageText = '';
}
