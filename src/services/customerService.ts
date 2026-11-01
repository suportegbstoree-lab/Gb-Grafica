import { auth } from '../firebase';
import { apiFetch } from './apiClient';
import { apiErrorMessage } from '../lib/apiError';
import type { CustomerProfile } from '../lib/customerProfile';
import type { Order } from '../types';
import type { ProductRating } from '../lib/catalog';
export interface ProductReview {
  id: string;
  rating: number;
  comment: string;
  authorName: string;
  verifiedPurchase: boolean;
  updatedAt: string;
}
export interface CustomerApi {
  profile(): Promise<CustomerProfile>;
  saveProfile(profile: CustomerProfile): Promise<CustomerProfile>;
  orders(): Promise<Order[]>;
  ratings(): Promise<Record<string, ProductRating>>;
  reviews(id: string): Promise<{ reviews: ProductReview[]; rating: ProductRating }>;
  review(id: string, input: { orderId: string; rating: number; comment: string }): Promise<void>;
}
async function request<T>(path: string, body?: unknown, privateCall = true): Promise<T> {
  const user = auth.currentUser;
  if (privateCall && !user) throw new Error('Entre com sua conta para continuar.');
  const response = await apiFetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(privateCall ? { Authorization: `Bearer ${await user!.getIdToken()}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(data, 'Não foi possível consultar os dados.'));
  return data;
}
export const customerApi: CustomerApi = {
  profile: () => request('account/profile'),
  saveProfile: ({ revision, ...profile }) => request('account/profile', { ...profile, expectedRevision: revision }),
  orders: async () => (await request<{ orders: Order[] }>('account/orders')).orders,
  ratings: async () =>
    (await request<{ ratings: Record<string, ProductRating> }>('products/ratings', undefined, false)).ratings,
  reviews: (id) => request(`products/${encodeURIComponent(id)}/reviews`, undefined, false),
  review: (id, input) => request(`products/${encodeURIComponent(id)}/reviews`, input),
};
