export type AppRole = "owner" | "adviser";

export type Profile = {
  id: string;
  full_name: string;
  role: AppRole;
};

export type Product = {
  id: string;
  sku: string;
  name: string;
  unit_price_cents: number;
  active: boolean;
};

export type Customer = {
  id: string;
  name: string;
  city: string;
  active: boolean;
};

export type Order = {
  id: string;
  customer_id: string;
  created_by: string;
  exchange_rate: number;
  total_usd_cents: number;
  total_sdg: number;
  status: string;
  created_at: string;
  shamsy_customers?: Customer | null;
};

export type OrderLine = {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price_cents: number;
  discount_cents: number;
  line_value_cents: number;
  line_total_cents: number;
  discount_bps: number;
  approval: "none" | "required" | "approved";
  shamsy_products?: Product | null;
};

export type AppSetting = {
  key: string;
  value: number | string | boolean | null;
};

export type DiscountApproval = {
  id: string;
  requested_by: string;
  customer_id: string;
  exchange_rate: number;
  payload: {
    lines: Array<{
      product_id: string;
      quantity: number;
      discount_cents: number;
      needs_approval: boolean;
    }>;
  };
  status: "pending" | "approved" | "rejected" | "consumed";
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  shamsy_customers?: Customer | null;
};
