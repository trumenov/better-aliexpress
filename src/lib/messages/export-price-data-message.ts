import { MessageTypes } from './message-types.ts';

export const ENDPOINT_KEY = 'priceExporterEndpoint';

export type ExportPriceDataMessage = {
  type: MessageTypes;
  data: {
    productId: string;
    productName: string;
    vendorId: string;
    vendorName: string;
    shippingCost: string;
    currency: string;
    message?: string;
    variants: { name: string; price: string; skuCol: string }[];
  };
};

export type ExportPriceDataResponse = {
  success: boolean;
  error?: string;
};
