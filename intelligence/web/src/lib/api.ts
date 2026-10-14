// Cliente HTTP: envia o cabeçalho anti-CSRF e transforma erros em mensagens legíveis.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

type Json = Record<string, unknown> | unknown[] | null;

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, url: string, body?: Json | FormData, opts: { raw?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "X-Cuidare": "1" };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "network", "Sem conexão com o servidor. Verifique a internet.");
  }
  if (opts.raw && res.ok) return res as unknown as T;
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    if (res.status === 401 && data.error === "unauthenticated" && onUnauthorized && !url.endsWith("/api/auth/me")) onUnauthorized();
    throw new ApiError(res.status, String(data.error ?? "error"), String(data.message ?? `Erro ${res.status}`), data);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: Json | FormData) => request<T>("POST", url, body ?? {}),
  patch: <T>(url: string, body: Json) => request<T>("PATCH", url, body),
  put: <T>(url: string, body: Json) => request<T>("PUT", url, body),
  del: <T>(url: string) => request<T>("DELETE", url),
  /** Baixa um arquivo (POST com corpo ou GET) e dispara o download no navegador. */
  async download(url: string, body?: Json) {
    const res = await request<Response>(body ? "POST" : "GET", url, body, { raw: true });
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") ?? "";
    const m = cd.match(/filename\*=UTF-8''([^;]+)/);
    const name = m ? decodeURIComponent(m[1]) : "arquivo";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  },
};

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, v === true ? "1" : String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
