import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { MemoryError } from "../errors.js";

export type DnsResolver = (hostname: string) => Promise<ReadonlyArray<{ address: string; family: number }>>;

export const defaultDnsResolver: DnsResolver = async (hostname) => await lookup(hostname, { all: true, verbatim: true });

export async function validatePublicUrl(value: string | URL, resolver: DnsResolver = defaultDnsResolver): Promise<URL> {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value.href) : new URL(value);
  } catch {
    throw unsafeUrl("网址格式无效。");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw unsafeUrl("只允许 HTTP 或 HTTPS 网站。");
  if (url.username || url.password) throw unsafeUrl("网址不能包含账号或密码。");
  if (url.port && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))) {
    throw unsafeUrl("不允许非标准端口。");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLocaleLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) throw unsafeUrl("不允许本机或内网主机。");
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolver(hostname);
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) throw unsafeUrl("网址解析到了本机、内网或保留地址。");
  return url;
}

export function canonicalizeUrl(value: string | URL): string {
  const url = value instanceof URL ? new URL(value.href) : new URL(value);
  url.hash = "";
  url.hostname = url.hostname.toLocaleLowerCase();
  return url.href;
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLocaleLowerCase().split("%")[0] ?? "";
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  if (isIP(normalized) === 4) {
    const octets = normalized.split(".").map(Number);
    const [a = 0, b = 0] = octets;
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || b === 0))
      || (a === 198 && (b === 18 || b === 19 || b === 51))
      || (a === 203 && b === 0);
  }
  if (isIP(normalized) === 6) {
    return normalized === "::" || normalized === "::1"
      || normalized.startsWith("fc") || normalized.startsWith("fd")
      || /^fe[89ab]/.test(normalized)
      || normalized.startsWith("2001:db8:");
  }
  return true;
}

function unsafeUrl(message: string): MemoryError {
  return new MemoryError("UNSAFE_URL", message, false, "请提供无需登录的公开网页地址。 ");
}
