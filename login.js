(() => {
  'use strict';

  /* -------------------------------------------------------------------------
     How this section works

     1. ACCOUNTS (real log in and sign up)
        Set supabaseUrl and supabaseKey below. Visitors can then create an
        account (email, mobile number, password), log in, log out, and reset a
        forgotten password. Supabase stores the accounts. Passwords are saved
        scrambled (hashed), so nobody can read them, not even you. You see the
        email and mobile number in Supabase: Authentication, then Users.

        Only ever use the project's public "anon" (or "publishable") key here.
        It is meant to be visible in the page. NEVER put the "service_role"
        (or "secret") key or your database password anywhere in this site.

     2. LAUNCH LIST (default until step 1 is done)
        Visitors leave an email address or a mobile number, and Netlify Forms
        saves it under the name "yukti-signup" (Netlify: open the project, then
        the Forms tab). No passwords are ever collected in this mode.

     You can also set window.YUKTI_CONFIG before this script loads to override
     any of the values below.
     ------------------------------------------------------------------------- */
  const CONFIG = {
    supabaseUrl: '',   // e.g. 'https://abcdefgh.supabase.co'
    supabaseKey: '',   // the project's anon / publishable key
    formName: 'yukti-signup',
    simulate: null,         // launch list only. null = preview on localhost or a local file, real on a live site
    previewAccounts: false, // show the account forms with an in-page demo backend (never saved)
    ...window.YUKTI_CONFIG,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  if (!$('.login-card')) return;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const say = (node, message = '', kind = '') => {
    node.textContent = message;
    node.className = `status ${kind}`.trim();
  };

  const busy = (btn, label, on) => {
    btn.disabled = on;
    btn.setAttribute('aria-busy', String(on));
    btn.querySelector('span').textContent = label;
  };

  const flagInvalid = (field, on) => {
    if (on) field.setAttribute('aria-invalid', 'true');
    else field.removeAttribute('aria-invalid');
  };

  /* ---------- Validation shared by both modes ---------- */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const maskEmail = (value) => {
    const [name, domain] = value.split('@');
    return `${name[0]}${'•'.repeat(Math.min(Math.max(name.length - 1, 1), 5))}@${domain}`;
  };

  const readEmail = (input) => {
    const value = input.value.trim().toLowerCase();
    if (!EMAIL_RE.test(value)) return { error: 'Enter a valid email address, like name@example.com.' };
    return { value, mask: maskEmail(value) };
  };

  const readPhone = (select, input) => {
    const digits = input.value.replace(/\D/g, '');
    const code = select.value;
    const valid = code === '+91' ? /^[6-9]\d{9}$/.test(digits) : /^\d{6,14}$/.test(digits);
    if (!valid) {
      return {
        error: code === '+91'
          ? 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9.'
          : 'Enter a valid mobile number.',
      };
    }
    return { value: code + digits, mask: `${code} ${'•'.repeat(Math.max(digits.length - 3, 0))}${digits.slice(-3)}` };
  };

  // The "Log in" button in the nav scrolls to this section.
  const focusOnArrival = (getField) => {
    $$('a[href="#login"]').forEach((link) => {
      link.addEventListener('click', () => {
        setTimeout(() => { const field = getField(); if (field) field.focus({ preventScroll: true }); }, reduceMotion ? 0 : 600);
      });
    });
  };

  /* ==========================================================================
     LAUNCH LIST: email or phone saved by Netlify Forms
     ========================================================================== */
  const initLaunchList = () => {
    const simulate = CONFIG.simulate === null
      ? ['', 'localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
      : Boolean(CONFIG.simulate);

    const el = {
      note: $('#mode-note'),
      tabs: $('#waitlist .tabs'),
      tabEmail: $('#tab-email'),
      tabPhone: $('#tab-phone'),
      panelEmail: $('#panel-email'),
      panelPhone: $('#panel-phone'),
      stepIdentify: $('#step-identify'),
      stepDone: $('#step-done'),
      form: $('#login-form'),
      channelField: $('#login-channel'),
      honeypot: $('#bot-field'),
      email: $('#login-email'),
      cc: $('#login-cc'),
      phone: $('#login-phone'),
      sendBtn: $('#send-btn'),
      status: $('#login-status'),
      restart: $('#restart-btn'),
      doneTitle: $('#done-title'),
      doneText: $('#done-text'),
    };

    let channel = 'email';

    if (simulate) {
      el.note.hidden = false;
      el.note.textContent = 'Preview mode: nothing is saved here. On the live site your details are sent to Yukti.';
    }

    const setChannel = (next, focus = false) => {
      channel = next;
      const isEmail = next === 'email';
      el.channelField.value = next;
      el.tabs.dataset.tab = next;
      el.tabEmail.setAttribute('aria-selected', String(isEmail));
      el.tabPhone.setAttribute('aria-selected', String(!isEmail));
      el.tabEmail.tabIndex = isEmail ? 0 : -1;
      el.tabPhone.tabIndex = isEmail ? -1 : 0;
      el.panelEmail.hidden = !isEmail;
      el.panelPhone.hidden = isEmail;
      flagInvalid(el.email, false);
      flagInvalid(el.phone, false);
      say(el.status);
      if (focus) (isEmail ? el.tabEmail : el.tabPhone).focus();
    };

    [el.tabEmail, el.tabPhone].forEach((tab) => {
      tab.addEventListener('click', () => setChannel(tab.dataset.channel));
      tab.addEventListener('keydown', (e) => {
        const keys = { ArrowLeft: 'email', ArrowRight: 'phone', Home: 'email', End: 'phone' };
        if (!(e.key in keys)) return;
        e.preventDefault();
        setChannel(keys[e.key], true);
      });
    });

    [el.email, el.phone].forEach((field) => {
      field.addEventListener('input', () => { flagInvalid(field, false); say(el.status); });
    });

    focusOnArrival(() => (el.stepIdentify.hidden ? null : (channel === 'email' ? el.email : el.phone)));

    const save = async (identifier) => {
      if (simulate) { await delay(500); return; }
      const body = new URLSearchParams({
        'form-name': CONFIG.formName,
        channel,
        email: channel === 'email' ? identifier : '',
        phone: channel === 'phone' ? identifier : '',
        'bot-field': '',
      });
      const res = await fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    };

    el.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (el.honeypot.value) return; // only bots fill this hidden field in

      const entry = channel === 'email' ? readEmail(el.email) : readPhone(el.cc, el.phone);
      const field = channel === 'email' ? el.email : el.phone;
      if (entry.error) {
        flagInvalid(field, true);
        say(el.status, entry.error, 'err');
        field.focus();
        return;
      }

      busy(el.sendBtn, 'Saving…', true);
      say(el.status);
      try {
        await save(entry.value);
        el.stepIdentify.hidden = true;
        el.stepDone.hidden = false;
        el.doneTitle.textContent = 'You’re on the list';
        el.doneText.textContent = `We’ll contact you at ${entry.mask} the day Yukti launches.${simulate ? ' Preview only: nothing was saved.' : ''}`;
        el.stepDone.focus();
      } catch (err) {
        console.error('[Yukti] could not save contact:', err);
        say(el.status, err.status === 429
          ? 'Too many requests. Please wait a few minutes and try again.'
          : 'We couldn’t save your details just now. Please try again in a moment.', 'err');
      } finally {
        busy(el.sendBtn, 'Notify me', false);
      }
    });

    el.restart.addEventListener('click', () => {
      el.stepDone.hidden = true;
      el.stepIdentify.hidden = false;
      el.email.value = '';
      el.phone.value = '';
      say(el.status);
      setChannel('email');
      el.email.focus();
    });
  };

  /* ==========================================================================
     ACCOUNTS: sign up, log in, reset password (Supabase Auth)
     ========================================================================== */
  const STORE_KEY = 'yukti.session';
  const nowSec = () => Math.floor(Date.now() / 1000);

  const supabaseApi = (baseUrl, key) => {
    const call = async (path, { method = 'POST', body, token } = {}) => {
      const headers = { 'Content-Type': 'application/json', apikey: key };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${baseUrl}/auth/v1${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      let data = null;
      try { data = await res.json(); } catch (_) { /* empty body */ }
      if (!res.ok) {
        const err = new Error((data && (data.msg || data.error_description || data.message)) || `HTTP ${res.status}`);
        err.status = res.status;
        err.code = (data && (data.error_code || data.error)) || '';
        throw err;
      }
      return data;
    };
    return {
      signUp: (email, password, mobile) => call('/signup', { body: { email, password, data: { mobile } } }),
      signIn: (email, password) => call('/token?grant_type=password', { body: { email, password } }),
      refresh: (refreshToken) => call('/token?grant_type=refresh_token', { body: { refresh_token: refreshToken } }),
      recover: (email) => call('/recover', { body: { email } }),
      user: (token) => call('/user', { method: 'GET', token }),
      updatePassword: (token, password) => call('/user', { method: 'PUT', token, body: { password } }),
      signOut: (token) => call('/logout?scope=local', { token }),
    };
  };

  // In-page stand-in used only for the preview. Nothing is saved anywhere.
  const memoryApi = () => {
    const users = new Map();
    const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
    const sessionFor = (u) => ({
      access_token: `demo-${u.id}`,
      refresh_token: 'demo',
      expires_at: nowSec() + 3600,
      user: { id: u.id, email: u.email, user_metadata: { mobile: u.mobile } },
    });
    return {
      async signUp(email, password, mobile) {
        await delay(500);
        if (users.has(email)) throw fail(422, 'user_already_exists', 'User already registered');
        const u = { id: String(users.size + 1), email, password, mobile };
        users.set(email, u);
        return sessionFor(u);
      },
      async signIn(email, password) {
        await delay(500);
        const u = users.get(email);
        if (!u || u.password !== password) throw fail(400, 'invalid_credentials', 'Invalid login credentials');
        return sessionFor(u);
      },
      async refresh() { throw fail(401, 'session_expired', 'expired'); },
      async recover() { await delay(500); return {}; },
      async user() { throw fail(401, 'bad_jwt', 'invalid token'); },
      async updatePassword(token, password) {
        await delay(400);
        const u = [...users.values()].find((x) => `demo-${x.id}` === token);
        if (u) u.password = password;
        return {};
      },
      async signOut() { /* nothing to do */ },
    };
  };

  const explain = (err) => {
    const code = String(err.code || '');
    const msg = String(err.message || '').toLowerCase();
    if (err instanceof TypeError) return 'We couldn’t reach the server. Check your connection and try again.';
    if (err.status === 429 || code.includes('rate_limit')) return 'Too many attempts. Please wait a few minutes and try again.';
    if (code === 'email_not_confirmed' || msg.includes('not confirmed')) return 'Please confirm your email first. Check your inbox for our link.';
    if (code === 'invalid_credentials' || msg.includes('invalid login')) return 'That email and password don’t match. Check them and try again.';
    if (code === 'user_already_exists' || msg.includes('already registered')) return 'This email already has an account. Log in instead.';
    if (code === 'same_password') return 'Choose a password that’s different from your old one.';
    if (code === 'weak_password' || msg.includes('password')) return 'Choose a stronger password: at least 8 characters that are hard to guess.';
    if (code === 'signup_disabled') return 'New accounts can’t be created right now.';
    if (err.status === 401 || code === 'bad_jwt' || code === 'session_expired') return 'That link has expired. Ask for a new one and try again.';
    return 'Something went wrong. Please try again in a moment.';
  };

  const initAccounts = (real) => {
    const api = real ? supabaseApi(CONFIG.supabaseUrl.replace(/\/+$/, ''), CONFIG.supabaseKey) : memoryApi();

    const root = $('#accounts');
    const el = {
      title: $('#login-title'),
      lede: $('#login-lede'),
      note: $('#mode-note'),
      tabs: $('#acct-tabs'),
      loginForm: $('#acct-login-form'),
      loginEmail: $('#acct-login-email'),
      loginPassword: $('#acct-login-password'),
      loginStatus: $('#acct-login-status'),
      loginBtn: $('#acct-login-btn'),
      signupForm: $('#acct-signup-form'),
      signupEmail: $('#acct-signup-email'),
      signupCc: $('#acct-signup-cc'),
      signupPhone: $('#acct-signup-phone'),
      signupPassword: $('#acct-signup-password'),
      signupStatus: $('#acct-signup-status'),
      signupBtn: $('#acct-signup-btn'),
      forgotForm: $('#acct-forgot-form'),
      forgotEmail: $('#acct-forgot-email'),
      forgotStatus: $('#acct-forgot-status'),
      forgotBtn: $('#acct-forgot-btn'),
      resetForm: $('#acct-reset-form'),
      resetPassword: $('#acct-reset-password'),
      resetStatus: $('#acct-reset-status'),
      resetBtn: $('#acct-reset-btn'),
      notice: $('#acct-notice'),
      noticeTitle: $('#notice-title'),
      noticeText: $('#notice-text'),
      noticeBtn: $('#notice-btn'),
      account: $('#acct-account'),
      accountTitle: $('#account-title'),
      emailOut: $('#acct-email-out'),
      mobileOut: $('#acct-mobile-out'),
      logout: $('#acct-logout'),
    };

    /* ----- Swap the launch list for the account forms ----- */
    $('#waitlist').hidden = true;
    root.hidden = false;
    el.title.innerHTML = 'Log in or <em>create an account.</em>';
    el.lede.textContent = 'Your details are stored securely. Passwords are scrambled, so nobody can read them, not even us.';
    if (!real) {
      el.note.hidden = false;
      el.note.textContent = 'Preview mode: accounts live in this page only and vanish when you reload.';
    }

    /* ----- Session ----- */
    let session = null;

    const toSession = (d) => ({
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: d.expires_at || nowSec() + (d.expires_in || 3600),
      user: d.user,
    });

    const persist = (s) => {
      if (!real) return;
      try {
        if (s) localStorage.setItem(STORE_KEY, JSON.stringify(s));
        else localStorage.removeItem(STORE_KEY);
      } catch (_) { /* storage blocked: the session just lasts until reload */ }
    };

    const setSession = (s) => {
      session = s;
      persist(s);
      $$('a.btn[href="#login"]').forEach((link) => { link.textContent = s ? 'My account' : 'Log in'; });
    };

    const restoreSession = async () => {
      if (!real) return null;
      let stored = null;
      try { stored = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (_) { /* nothing stored */ }
      if (!stored || !stored.access_token) return null;
      if (stored.expires_at - nowSec() > 30) return stored;
      try {
        return toSession({ ...(await api.refresh(stored.refresh_token)) });
      } catch (_) {
        persist(null);
        return null;
      }
    };

    /* ----- Views ----- */
    const panels = $$('[data-panel]', root);
    const tabButtons = $$('.tab', el.tabs);

    const show = (name, focus = false) => {
      panels.forEach((panel) => { panel.hidden = panel.dataset.panel !== name; });
      const isTabbed = name === 'login' || name === 'signup';
      el.tabs.hidden = !isTabbed;
      if (isTabbed) {
        el.tabs.dataset.tab = name;
        tabButtons.forEach((tab) => {
          const on = tab.dataset.go === name;
          tab.setAttribute('aria-selected', String(on));
          tab.tabIndex = on ? 0 : -1;
        });
      }
      if (focus) {
        const panel = panels.find((p) => !p.hidden);
        const target = panel.matches('[tabindex]') ? panel : $('input, select', panel);
        if (target) target.focus({ preventScroll: true });
      }
    };

    const showNotice = (title, text, buttonLabel = 'Back to log in', goTo = 'login') => {
      el.noticeTitle.textContent = title;
      el.noticeText.textContent = text;
      el.noticeBtn.textContent = buttonLabel;
      el.noticeBtn.dataset.go = goTo;
      show('notice', true);
    };

    const showAccount = (title = 'You’re logged in', focus = true) => {
      const user = (session && session.user) || {};
      el.accountTitle.textContent = title;
      el.emailOut.textContent = user.email || '';
      el.mobileOut.textContent = (user.user_metadata && user.user_metadata.mobile) || 'Not provided';
      show('account', focus);
    };

    const scrollHere = () => {
      $('#login').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    };

    $$('[data-go]', root).forEach((control) => {
      control.addEventListener('click', () => {
        [el.loginStatus, el.signupStatus, el.forgotStatus, el.resetStatus].forEach((s) => say(s));
        if (control.dataset.go === 'account') showAccount();
        else show(control.dataset.go, true);
      });
    });

    tabButtons.forEach((tab) => {
      tab.addEventListener('keydown', (e) => {
        const keys = { ArrowLeft: 'login', ArrowRight: 'signup', Home: 'login', End: 'signup' };
        if (!(e.key in keys)) return;
        e.preventDefault();
        show(keys[e.key]);
        $(`#acct-tab-${keys[e.key]}`).focus();
      });
    });

    // Show / hide password
    $$('.pw-toggle', root).forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.for);
        const reveal = input.type === 'password';
        input.type = reveal ? 'text' : 'password';
        btn.textContent = reveal ? 'Hide' : 'Show';
        btn.setAttribute('aria-pressed', String(reveal));
        btn.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
      });
    });

    [el.loginEmail, el.loginPassword, el.signupEmail, el.signupPhone, el.signupPassword, el.forgotEmail, el.resetPassword]
      .forEach((field) => field.addEventListener('input', () => flagInvalid(field, false)));

    focusOnArrival(() => {
      const panel = panels.find((p) => !p.hidden);
      return panel ? $('input, select', panel) : null;
    });

    /* ----- Log in ----- */
    el.loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = readEmail(el.loginEmail);
      if (email.error) {
        flagInvalid(el.loginEmail, true);
        say(el.loginStatus, email.error, 'err');
        el.loginEmail.focus();
        return;
      }
      if (!el.loginPassword.value) {
        flagInvalid(el.loginPassword, true);
        say(el.loginStatus, 'Enter your password.', 'err');
        el.loginPassword.focus();
        return;
      }
      busy(el.loginBtn, 'Logging in…', true);
      say(el.loginStatus);
      try {
        setSession(toSession(await api.signIn(email.value, el.loginPassword.value)));
        el.loginForm.reset();
        showAccount();
      } catch (err) {
        console.error('[Yukti] log in failed:', err);
        say(el.loginStatus, explain(err), 'err');
      } finally {
        busy(el.loginBtn, 'Log in', false);
      }
    });

    /* ----- Create account ----- */
    el.signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = readEmail(el.signupEmail);
      const phone = readPhone(el.signupCc, el.signupPhone);
      const password = el.signupPassword.value;
      const problem = email.error
        ? [el.signupEmail, email.error]
        : phone.error
          ? [el.signupPhone, phone.error]
          : password.length < 8
            ? [el.signupPassword, 'Use a password with at least 8 characters.']
            : null;
      if (problem) {
        flagInvalid(problem[0], true);
        say(el.signupStatus, problem[1], 'err');
        problem[0].focus();
        return;
      }
      busy(el.signupBtn, 'Creating account…', true);
      say(el.signupStatus);
      try {
        const data = await api.signUp(email.value, password, phone.value);
        el.signupForm.reset();
        if (data && data.access_token) {
          setSession(toSession(data)); // email confirmation is switched off: logged in straight away
          showAccount('Account created');
        } else {
          showNotice(
            'Check your inbox',
            `We’ve sent a confirmation link to ${email.mask}. Click it, then log in. Already have an account? Just log in.`,
          );
        }
      } catch (err) {
        console.error('[Yukti] sign up failed:', err);
        say(el.signupStatus, explain(err), 'err');
      } finally {
        busy(el.signupBtn, 'Create account', false);
      }
    });

    /* ----- Forgot password ----- */
    el.forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = readEmail(el.forgotEmail);
      if (email.error) {
        flagInvalid(el.forgotEmail, true);
        say(el.forgotStatus, email.error, 'err');
        el.forgotEmail.focus();
        return;
      }
      busy(el.forgotBtn, 'Sending…', true);
      say(el.forgotStatus);
      try {
        await api.recover(email.value);
        el.forgotForm.reset();
        showNotice('Check your inbox', `If there’s an account for ${email.mask}, we’ve sent a link to choose a new password.`);
      } catch (err) {
        console.error('[Yukti] password reset failed:', err);
        say(el.forgotStatus, explain(err), 'err');
      } finally {
        busy(el.forgotBtn, 'Send reset link', false);
      }
    });

    /* ----- New password (after the emailed link) ----- */
    el.resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = el.resetPassword.value;
      if (password.length < 8) {
        flagInvalid(el.resetPassword, true);
        say(el.resetStatus, 'Use a password with at least 8 characters.', 'err');
        el.resetPassword.focus();
        return;
      }
      busy(el.resetBtn, 'Saving…', true);
      say(el.resetStatus);
      try {
        await api.updatePassword(session.access_token, password);
        el.resetForm.reset();
        showNotice('Password updated', 'You’re logged in with your new password.', 'Continue', 'account');
      } catch (err) {
        console.error('[Yukti] password update failed:', err);
        say(el.resetStatus, explain(err), 'err');
      } finally {
        busy(el.resetBtn, 'Save new password', false);
      }
    });

    /* ----- Log out ----- */
    el.logout.addEventListener('click', async () => {
      const token = session && session.access_token;
      setSession(null);
      show('login', true);
      try { if (token) await api.signOut(token); } catch (_) { /* the local session is already gone */ }
    });

    /* ----- Links from emails (confirm address, reset password) land here with a #hash ----- */
    const cleanUrl = () => history.replaceState(null, '', location.pathname + location.search);

    const handleEmailLink = async () => {
      const params = new URLSearchParams(location.hash.replace(/^#/, ''));

      if (params.has('error') || params.has('error_code')) {
        cleanUrl();
        show('login');
        say(el.loginStatus, 'That link has expired or was already used. Log in, or reset your password to get a new link.', 'err');
        scrollHere();
        return true;
      }

      const token = params.get('access_token');
      if (!token) return false;

      const type = params.get('type');
      const refreshToken = params.get('refresh_token');
      const expiresAt = Number(params.get('expires_at')) || nowSec() + Number(params.get('expires_in') || 3600);
      cleanUrl();
      try {
        const user = await api.user(token);
        setSession({ access_token: token, refresh_token: refreshToken, expires_at: expiresAt, user });
      } catch (err) {
        console.error('[Yukti] could not open email link:', err);
        show('login');
        say(el.loginStatus, 'We couldn’t open that link. Please log in.', 'err');
        scrollHere();
        return true;
      }
      if (type === 'recovery') show('reset');
      else showAccount(type === 'signup' ? 'Email confirmed' : 'You’re logged in');
      scrollHere();
      return true;
    };

    /* ----- Start ----- */
    (async () => {
      if (await handleEmailLink()) return;
      const restored = await restoreSession();
      if (restored) {
        setSession(restored);
        showAccount('You’re logged in', false);
      } else {
        show('login');
      }
    })();
  };

  /* ---------- Pick the mode ---------- */
  const real = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseKey);
  if (real || CONFIG.previewAccounts) initAccounts(real);
  else initLaunchList();
})();
