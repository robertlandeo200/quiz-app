function userId() {
  try {
    let v = localStorage.getItem('quiz_uid');
    if (!v) { v = crypto.randomUUID(); localStorage.setItem('quiz_uid', v); }
    return v;
  } catch { return 'anon-' + Math.random().toString(36).slice(2, 12); }
}
const uid = userId();
export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', 'X-User-Id': uid }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new Error('Cannot reach the server. Check your connection and try again.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
