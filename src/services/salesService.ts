import { auth } from "../firebase";
import { apiFetch } from "./apiClient";
import { apiErrorMessage } from "../lib/apiError";
import type {
  AppliedCoupon,
  CouponDraft,
  SalesCoupon,
} from "../lib/salesCoupons";
import type { VariationType } from "../lib/productSales";

async function request<T>(
  url: string,
  token: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await apiFetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      apiErrorMessage(data, "Não foi possível acessar o cadastro de vendas."),
    );
  return data as T;
}

export interface SalesAdminApi {
  variationTypes(): Promise<{ rows: VariationType[]; truncated: boolean }>;
  saveVariationType(
    name: string,
    previous?: VariationType,
  ): Promise<VariationType>;
  deleteVariationType(row: VariationType): Promise<void>;
  coupons(): Promise<{ rows: SalesCoupon[]; truncated: boolean }>;
  saveCoupon(draft: CouponDraft, previous?: SalesCoupon): Promise<void>;
  deleteCoupon(row: SalesCoupon): Promise<void>;
}

export function createSalesAdminApi(
  token: () => Promise<string>,
  prefix = "/api/admin/sales",
): SalesAdminApi {
  return {
    variationTypes: async () =>
      request(prefix + "/variation-types", await token()),
    saveVariationType: async (name, previous) => {
      const { row } = await request<{ row: VariationType }>(
        prefix + "/variation-types",
        await token(),
        {
          id: previous?.id,
          revision: previous?.revision,
          draft: { name },
        },
      );
      return row;
    },
    deleteVariationType: async (row) => {
      await request(prefix + "/variation-types", await token(), {
        id: row.id,
        revision: row.revision,
        remove: true,
      });
    },
    coupons: async () => request(prefix + "/coupons", await token()),
    saveCoupon: async (draft, previous) => {
      await request(prefix + "/coupons", await token(), {
        id: previous?.code,
        revision: previous?.revision,
        draft,
      });
    },
    deleteCoupon: async (row) => {
      await request(prefix + "/coupons", await token(), {
        id: row.code,
        revision: row.revision,
        remove: true,
      });
    },
  };
}

export const salesAdminApi = createSalesAdminApi(async () => {
  if (!auth.currentUser) throw new Error("Entre novamente para continuar.");
  return auth.currentUser.getIdToken();
});

export async function quoteCoupon(
  token: string,
  items: unknown,
  couponCode: string,
  signal: AbortSignal,
) {
  return request<{ coupon: AppliedCoupon | null }>(
    "/api/checkout/coupon",
    token,
    { items, couponCode },
    signal,
  );
}
