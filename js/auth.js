// Auth מינימלי מעל Supabase Auth REST API — בלי ספריית לקוח חיצונית (CDN עלול
// להיחסם ע"י נטפרי לדומיינים לא-מאושרים). כל הקריאות ל-*.supabase.co בלבד.
// עמוד יחיד (לא login.html נפרד): כשאין session תקף מציגים מסך כניסה בתוך האפליקציה.
const AUTH = {
  KEY: 'gemach_session',

  getSession() {
    try { return JSON.parse(localStorage.getItem(this.KEY)); }
    catch (e) { return null; }
  },
  setSession(s) { localStorage.setItem(this.KEY, JSON.stringify(s)); },
  clearSession() { localStorage.removeItem(this.KEY); },

  isValid() {
    const s = this.getSession();
    return !!(s && s.access_token && Date.now() < s.expires_at);
  },

  async login(email, password) {
    const res = await fetch(`${CFG.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': CFG.anon },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || 'שגיאת התחברות');
    this.setSession({ access_token: data.access_token, user: data.user, expires_at: Date.now() + data.expires_in * 1000 });
    return data;
  },

  logout() { this.clearSession(); location.reload(); },

  // עוזר קריאות ל-PostgREST על schema gemach_kspim, עם ה-token של המשתמש המחובר
  // (RLS פועל לפי auth.uid() אמיתי — לא לפי anon). זורק Error עם הודעה בעברית
  // אם נכשל; מחזיר null על 204/גוף ריק (הצלחה בלי תוכן, למשל DELETE).
  async api(path, opts) {
    const s = this.getSession();
    if (!this.isValid()) { this.clearSession(); throw new Error('הפג תוקף — יש להתחבר מחדש'); }
    opts = opts || {};
    const headers = Object.assign({
      'apikey': CFG.anon,
      'Authorization': `Bearer ${s.access_token}`,
      'Content-Type': 'application/json',
      'Accept-Profile': CFG.schema,
      'Content-Profile': CFG.schema
    }, opts.headers || {});
    const res = await fetch(`${CFG.url}/rest/v1/${path}`, Object.assign({}, opts, { headers }));
    if (res.status === 401) { this.clearSession(); throw new Error('הפג תוקף — יש להתחבר מחדש'); }
    const text = await res.text();
    if (!res.ok) {
      let err = {};
      try { err = JSON.parse(text); } catch (e) {}
      throw new Error(err.message || `שגיאת שרת (${res.status})`);
    }
    if (!text) return null;
    return JSON.parse(text);
  }
};
