/** Stripe Checkout parameters (issue #141, US-4). */
import { describe, expect, it } from "vitest";
import { checkoutParams, parsePlan } from "@/supabase/functions/create-checkout/logic";

const USER = "11111111-2222-3333-4444-555555555555";
const base = {
  userId: USER,
  email: "someone@example.test",
  plan: "monthly" as const,
  prices: { monthly: "price_monthly", yearly: "price_yearly" },
  appUrl: "https://ghassenazzouz.github.io/finance",
  customerId: null,
  firstSubscription: true,
};

describe("checkoutParams", () => {
  it("subscribes to the chosen price with the user's id for the webhook, and the 14-day trial the first time", () => {
    const p = checkoutParams(base);
    expect(p.get("mode")).toBe("subscription");
    expect(p.get("line_items[0][price]")).toBe("price_monthly");
    expect(p.get("client_reference_id")).toBe(USER);
    expect(p.get("subscription_data[metadata][user_id]")).toBe(USER);
    expect(p.get("subscription_data[trial_period_days]")).toBe("14");
    expect(p.get("customer_email")).toBe("someone@example.test");
    expect(p.get("customer")).toBeNull();
  });

  it("reuses the Stripe customer and gives no second trial", () => {
    const p = checkoutParams({ ...base, plan: "yearly", customerId: "cus_123", firstSubscription: false });
    expect(p.get("line_items[0][price]")).toBe("price_yearly");
    expect(p.get("customer")).toBe("cus_123");
    expect(p.get("customer_email")).toBeNull();
    expect(p.get("subscription_data[trial_period_days]")).toBeNull();
  });

  it("comes back to the success page with the session id, or to the cancel page", () => {
    const p = checkoutParams(base);
    expect(p.get("success_url")).toBe("https://ghassenazzouz.github.io/finance/abonnement/succes/?session_id={CHECKOUT_SESSION_ID}");
    expect(p.get("cancel_url")).toBe("https://ghassenazzouz.github.io/finance/abonnement/annule/");
  });
});

describe("parsePlan", () => {
  it("accepts the two plans only", () => {
    expect(parsePlan("monthly")).toBe("monthly");
    expect(parsePlan("yearly")).toBe("yearly");
    expect(parsePlan("lifetime")).toBeNull();
    expect(parsePlan(undefined)).toBeNull();
  });
});
