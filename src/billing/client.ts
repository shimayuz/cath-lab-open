export async function accountPost<T = Record<string, unknown>>(
  path: string,
  data: unknown = {},
): Promise<T> {
  const response = await fetch(
    new URL(`api/${path}`, window.location.origin + "/"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cath-Lab": "hand-intent-v1",
      },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(20000),
    },
  );
  const body = await response.json();
  if (!response.ok)
    throw Error(typeof body.code === "string" ? body.code : "unavailable");
  return body as T;
}
export function openStripe(url: unknown) {
  if (typeof url !== "string") throw Error("unavailable");
  const target = new URL(url);
  if (
    target.protocol !== "https:" ||
    !["checkout.stripe.com", "billing.stripe.com"].includes(target.hostname)
  )
    throw Error("unavailable");
  window.location.assign(target.href);
}
