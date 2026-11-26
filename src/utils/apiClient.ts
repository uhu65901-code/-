export type ServerHealthStatus = 'checking' | 'ready' | 'auth_wall' | 'offline' | 'unreachable';

export type ApiPostResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; kind: 'http_error'; status: number; data: Record<string, unknown>; message: string }
  | { ok: false; kind: 'proxy_or_html'; status: number; message: string }
  | { ok: false; kind: 'offline' | 'timeout' | 'unreachable'; message: string };

function tryParseJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function checkServerHealth(): Promise<ServerHealthStatus> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'offline';
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch('/api/health', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await res.text();
    const json = tryParseJson(text);
    if (res.ok && json && json.ok === true) {
      return 'ready';
    }
    if (res.redirected || res.status === 401 || res.status === 403 || !json) {
      return 'auth_wall';
    }
    return 'unreachable';
  } catch {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return 'offline';
    }
    return 'unreachable';
  } finally {
    window.clearTimeout(timer);
  }
}

export async function postJsonWithRetry<T = Record<string, unknown>>(
  url: string,
  body: unknown,
  maxAttempts = 3
): Promise<ApiPostResult<T>> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      ok: false,
      kind: 'offline',
      message: 'อุปกรณ์ไม่ได้เชื่อมต่ออินเทอร์เน็ต กรุณาตรวจสอบ Wi-Fi หรือ 4G/5G แล้วลองใหม่',
    };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 16000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const rawText = await res.text();
      const parsed = tryParseJson(rawText);

      // Transient gateway/cold-start errors -> retry
      if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 750 * attempt));
        continue;
      }

      if (!parsed || res.redirected) {
        return {
          ok: false,
          kind: 'proxy_or_html',
          status: res.status,
          message:
            'เซิร์ฟเวอร์ตอบกลับไม่ใช่ข้อมูลระบบ (อาจเกิดจากเซสชันเว็บหมดอายุในแอป หรือเซิร์ฟเวอร์กำลังเริ่มทำงาน) กรุณากด "ลองเชื่อมต่อใหม่" หรือเปิดผ่าน Chrome รีเฟรชหน้า 1 ครั้ง',
        };
      }

      if (res.ok || res.status === 202) {
        return {
          ok: true,
          status: res.status,
          data: parsed as T,
        };
      }

      return {
        ok: false,
        kind: 'http_error',
        status: res.status,
        data: parsed,
        message:
          typeof parsed.error === 'string' && parsed.error
            ? parsed.error
            : `เข้าสู่ระบบไม่สำเร็จ (HTTP ${res.status})`,
      };
    } catch (err) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return {
          ok: false,
          kind: 'offline',
          message: 'การเชื่อมต่ออินเทอร์เน็ตขาดหาย กรุณาตรวจสอบสัญญาณแล้วลองใหม่',
        };
      }

      const isTimeout = err instanceof Error && err.name === 'AbortError';
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 750 * attempt));
        continue;
      }

      if (isTimeout) {
        return {
          ok: false,
          kind: 'timeout',
          message: 'เซิร์ฟเวอร์ตอบสนองช้าเกินไป กรุณากดลองใหม่อีกครั้ง',
        };
      }

      return {
        ok: false,
        kind: 'unreachable',
        message:
          'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์หลังบ้านได้ในขณะนี้ (หากเปิดในแอปที่ติดตั้งไว้บนมือถือแล้วเซสชันหมดอายุ ให้ลองเปิดผ่านเบราว์เซอร์ Chrome หรือใช้โหมด Demo ในเครื่องแทนได้)',
      };
    } finally {
      window.clearTimeout(timer);
    }
  }

  return {
    ok: false,
    kind: 'unreachable',
    message: 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่',
  };
}
