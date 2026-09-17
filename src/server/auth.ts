/**
 * 极简访问口令：APP_PASSWORD 非空时启用。
 * cookie 值 = SHA-256(APP_PASSWORD + AUTH_SECRET)，中间件与登录接口共用；Web Crypto 在 edge 与 node 都可用。
 */
export const AUTH_COOKIE = "slate_auth";

export function authEnabled() {
  return Boolean(process.env.APP_PASSWORD);
}

export async function expectedToken() {
  const raw = `${process.env.APP_PASSWORD ?? ""}::${process.env.AUTH_SECRET ?? "slate"}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
