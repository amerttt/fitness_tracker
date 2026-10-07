"use strict";

// Supabase sync: IndexedDB stays the source the app reads and writes; this file mirrors it to Postgres
// when signed in. Plain fetch against the REST endpoints, no library. Only the publishable key lives here;
// row access is limited by RLS (user_id = auth.uid()). Never put a service_role key in this repo.
const SUPABASE_URL = "https://qiuciwbpdpyvhgedfped.supabase.co";
const SUPABASE_KEY = "sb_publishable_HHutIg9eccd6ddwG7nbhJw_kZ4sTT7v";

let syncAccount = null; // email shown in the Ayarlar mode note while signed in
let syncing = false, syncAgain = false, syncTimer = null, syncMsg = "";

async function authCall(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.msg || json.error_description || json.message || `Hata ${res.status}`);
  return json;
}

async function storeSession(j) {
  if (!j.access_token) return null;
  const s = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in - 60) * 1000, email: j.user?.email, user_id: j.user?.id };
  await setMeta("session", s);
  return s;
}

async function getSession() {
  let s = await getMeta("session");
  if (!s) return null;
  if (Date.now() < s.expires_at) return s;
  try {
    const j = await authCall("token?grant_type=refresh_token", { refresh_token: s.refresh_token });
    s = await storeSession({ ...j, user: j.user || { email: s.email, id: s.user_id } });
  } catch (e) {
    // a rejected refresh token means signed out; a network error keeps the session for later
    if (!/fetch|network|load failed/i.test(e.message)) await setMeta("session", null);
    return null;
  }
  return s;
}

async function sbRest(session, path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + session.access_token, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`${path.split("?")[0]}: ${res.status}`);
  return opts.method === "POST" ? null : res.json();
}

async function syncNow() {
  if (syncing) { syncAgain = true; return; }
  if (!navigator.onLine) return;
  syncing = true;
  try {
    const session = await getSession();
    if (!session) return;
    syncMsg = "Eşitleniyor…";
    renderSync();
    const pushedTo = (await getMeta("pushedAt")) || 0;
    const started = Date.now();
    let pushed = 0, pulled = 0;
    for (const t of TABLES) {
      // push local changes in batches
      const rows = (await getAll(t)).filter((r) => r.updated_at > pushedTo);
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500).map((r) => ({ id: r.id, updated_at: r.updated_at, deleted: r.deleted ? 1 : 0, data: r }));
        await sbRest(session, `${t}?on_conflict=user_id,id`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(batch) });
        pushed += batch.length;
      }
      // pull what changed on the server since the last pull
      let since = (await getMeta("pulledAt:" + t)) || 0;
      for (;;) {
        const page = await sbRest(session, `${t}?select=id,updated_at,data&updated_at=gt.${since}&order=updated_at.asc&limit=1000`);
        const incoming = [];
        for (const r of page) {
          const local = await getOne(t, r.id);
          if (!local || r.updated_at > local.updated_at) incoming.push({ ...r.data, id: r.id, updated_at: r.updated_at });
        }
        if (incoming.length) await putMany(t, incoming);
        pulled += incoming.length;
        if (page.length) since = page[page.length - 1].updated_at;
        if (page.length < 1000) break;
      }
      await setMeta("pulledAt:" + t, since);
    }
    await setMeta("pushedAt", started);
    if (pulled) { await loadCache(); await ensurePrograms(); renderAll(); }
    syncMsg = `Eşitlendi ${new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })} · ${pushed} gönderildi, ${pulled} alındı`;
  } catch (e) {
    syncMsg = "Eşitlenemedi: " + e.message;
  } finally {
    syncing = false;
    // signed out with the form on screen: leave it alone so typed text survives a background sync
    if ((await getMeta("session")) || !$("#sy-in")) renderSync();
    if (syncAgain) { syncAgain = false; scheduleSync(); }
  }
}

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 2000);
}

async function renderSync() {
  const box = $("#s-sync");
  if (!box) return;
  const s = await getMeta("session");
  syncAccount = s ? s.email || "Hesap" : null;
  if (typeof renderMode === "function") renderMode();
  if (s) {
    box.innerHTML = `<p class="hint">${esc(s.email || "Hesap")} ile giriş yapıldı. ${esc(syncMsg)}</p>
      <button type="button" id="sy-now" class="primary">Şimdi eşitle</button>
      <button type="button" id="sy-out" class="ghost">Çıkış yap</button>`;
    $("#sy-now").onclick = syncNow;
    $("#sy-out").onclick = async () => { await setMeta("session", null); syncMsg = ""; renderSync(); toast("Çıkış yapıldı. Telefondaki kayıtlar silinmedi."); };
  } else {
    box.innerHTML = `<p class="hint">Hesap açarsan kayıtların sunucuya da yazılır, telefon değiştirince geri gelir. Telefondaki kayıtlar yine çevrimdışı çalışır.</p>
      <label>E-posta <input type="email" id="sy-email" autocomplete="email"></label>
      <label>Şifre (en az 6 karakter) <input type="password" id="sy-pass" autocomplete="current-password"></label>
      <button type="button" id="sy-in" class="primary">Giriş yap</button>
      <button type="button" id="sy-up" class="ghost">Hesap aç</button>
      <p class="hint" id="sy-msg">${esc(syncMsg)}</p>`;
    // show errors in place: re-rendering the card would wipe what was typed
    const say = (m) => { syncMsg = m; $("#sy-msg").textContent = m; };
    const tr = (m) => /invalid login credentials/i.test(m) ? "Bu e-posta ile hesap yok ya da şifre yanlış. Hesabın yoksa önce \"Hesap aç\"a bas."
      : /already registered|already been registered/i.test(m) ? "Bu e-posta ile hesap zaten var. \"Giriş yap\"a bas." : m;
    // an empty email makes Supabase answer "Anonymous sign-ins are disabled", so check before sending
    const creds = () => {
      const c = { email: $("#sy-email").value.trim(), password: $("#sy-pass").value };
      if (!c.email || !c.password) throw new Error("E-posta ve şifreyi yaz");
      if (c.password.length < 6) throw new Error("Şifre en az 6 karakter olmalı");
      return c;
    };
    $("#sy-in").onclick = async () => {
      try {
        const j = await authCall("token?grant_type=password", creds());
        await storeSession(j);
        syncMsg = "";
        await renderSync();
        syncNow();
      } catch (e) { say(tr(e.message)); }
    };
    $("#sy-up").onclick = async () => {
      try {
        const j = await authCall("signup", creds());
        if (j.access_token) { await storeSession(j); syncMsg = ""; await renderSync(); syncNow(); }
        else say("Hesap açıldı. E-postandaki bağlantıyı onayla, sonra giriş yap.");
      } catch (e) { say(tr(e.message)); }
    };
  }
}

function initSync() {
  renderSync();
  window.addEventListener("online", scheduleSync);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) scheduleSync(); });
  scheduleSync();
}
