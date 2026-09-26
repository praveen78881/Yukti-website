(() => {
  'use strict';

  /* -------------------------------------------------------------------------
     Sign-in service
     Log in works with a one-time code sent to an email address or a mobile
     number. The code must be created, sent and checked on a server; this page
     only collects the details and calls these two endpoints (JSON POST):

       sendUrl    { channel: 'email' | 'phone', identifier }         -> 2xx once the code is sent
       verifyUrl  { channel, identifier, code }                      -> 2xx if the code is right
                  (respond with 400/401/422 for a wrong code, 429 for too many tries;
                   set the session as an HttpOnly cookie, never in the page)
       redirectTo where to send people after a successful log in

     Good fits: Firebase Auth, Supabase Auth, or your own API with an SMS
     provider such as MSG91 or Twilio for phone codes and any mail service for
     email codes.

     Until both URLs are set the page is honest about it: on localhost it runs
     as a clearly labelled preview (no code is sent, any 6 digits pass), and on
     a live site it says log in is not open yet. It never signs anyone in.
     ------------------------------------------------------------------------- */
  const AUTH = {
    sendUrl: '',
    verifyUrl: '',
    redirectTo: '',
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  if (!$('.login-card')) return;

  const isLocal = ['', 'localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const live = Boolean(AUTH.sendUrl && AUTH.verifyUrl);
  const demo = !live && isLocal;

  const el = {
    note: $('#mode-note'),
    tabs: $('.tabs'),
    tabEmail: $('#tab-email'),
    tabPhone: $('#tab-phone'),
    panelEmail: $('#panel-email'),
    panelPhone: $('#panel-phone'),
    stepIdentify: $('#step-identify'),
    stepVerify: $('#step-verify'),
    stepDone: $('#step-done'),
    form: $('#login-form'),
    email: $('#login-email'),
    cc: $('#login-cc'),
    phone: $('#login-phone'),
    sendBtn: $('#send-btn'),
    loginStatus: $('#login-status'),
    verifyForm: $('#verify-form'),
    otp: $$('.otp input'),
    verifyStatus: $('#verify-status'),
    verifyBtn: $('#verify-btn'),
    target: $('#verify-target'),
    resend: $('#resend-btn'),
    change: $('#change-btn'),
    restart: $('#restart-btn'),
    doneText: $('#done-text'),
  };

  let channel = 'email';
  let identifier = '';
  let shown = '';
  let timerId = 0;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  const post = async (url, body) => {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res;
  };

  const sendCode = async () => {
    if (live) await post(AUTH.sendUrl, { channel, identifier });
    else await delay(500);
  };

  /* ---------- Mode banner ---------- */
  if (demo) {
    el.note.hidden = false;
    el.note.textContent = 'Preview mode: no code is sent and nothing is stored. Enter any 6 digits to continue.';
  } else if (!live) {
    el.note.hidden = false;
    el.note.classList.add('note-warn');
    el.note.textContent = 'Log in isn’t open yet. It goes live when Yukti launches.';
    $$('input, select, button[type="submit"]', el.form).forEach((node) => { node.disabled = true; });
  }

  /* ---------- Email / phone tabs ---------- */
  const setChannel = (next, focus = false) => {
    channel = next;
    const isEmail = next === 'email';
    el.tabs.dataset.tab = next;
    el.tabEmail.setAttribute('aria-selected', String(isEmail));
    el.tabPhone.setAttribute('aria-selected', String(!isEmail));
    el.tabEmail.tabIndex = isEmail ? 0 : -1;
    el.tabPhone.tabIndex = isEmail ? -1 : 0;
    el.panelEmail.hidden = !isEmail;
    el.panelPhone.hidden = isEmail;
    flagInvalid(el.email, false);
    flagInvalid(el.phone, false);
    say(el.loginStatus);
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

  // The "Log in" button in the nav scrolls here; put the cursor in the field once it arrives.
  $$('a[href="#login"]').forEach((link) => {
    link.addEventListener('click', () => {
      if (!el.stepIdentify.hidden && !el.email.disabled) {
        const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
        setTimeout(() => (channel === 'email' ? el.email : el.phone).focus({ preventScroll: true }), reduce ? 0 : 600);
      }
    });
  });

  /* ---------- Validation ---------- */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const maskEmail = (value) => {
    const [name, domain] = value.split('@');
    return `${name[0]}${'•'.repeat(Math.min(Math.max(name.length - 1, 1), 5))}@${domain}`;
  };

  const readIdentifier = () => {
    if (channel === 'email') {
      const value = el.email.value.trim().toLowerCase();
      if (!EMAIL_RE.test(value)) {
        return { field: el.email, error: 'Enter a valid email address, like name@example.com.' };
      }
      return { field: el.email, id: value, mask: maskEmail(value) };
    }
    const digits = el.phone.value.replace(/\D/g, '');
    const code = el.cc.value;
    const valid = code === '+91' ? /^[6-9]\d{9}$/.test(digits) : /^\d{6,14}$/.test(digits);
    if (!valid) {
      return {
        field: el.phone,
        error: code === '+91'
          ? 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9.'
          : 'Enter a valid mobile number.',
      };
    }
    return {
      field: el.phone,
      id: code + digits,
      mask: `${code} ${'•'.repeat(Math.max(digits.length - 3, 0))}${digits.slice(-3)}`,
    };
  };

  [el.email, el.phone].forEach((field) => {
    field.addEventListener('input', () => { flagInvalid(field, false); say(el.loginStatus); });
  });

  /* ---------- Step 1: send the code ---------- */
  el.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!live && !demo) return;

    const entry = readIdentifier();
    if (entry.error) {
      flagInvalid(entry.field, true);
      say(el.loginStatus, entry.error, 'err');
      entry.field.focus();
      return;
    }

    identifier = entry.id;
    shown = entry.mask;
    busy(el.sendBtn, 'Sending code…', true);
    say(el.loginStatus);
    try {
      await sendCode();
      showVerify();
    } catch (err) {
      console.error('[Yukti] send code failed:', err);
      say(
        el.loginStatus,
        err.status === 429
          ? 'Too many requests. Please wait a few minutes and try again.'
          : 'We couldn’t send the code. Check your details and try again.',
        'err',
      );
    } finally {
      busy(el.sendBtn, 'Send code', false);
    }
  });

  /* ---------- Step 2: enter the code ---------- */
  const startTimer = (seconds = 30) => {
    clearInterval(timerId);
    let left = seconds;
    el.resend.disabled = true;
    el.resend.textContent = `Resend code in ${left}s`;
    timerId = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(timerId);
        el.resend.disabled = false;
        el.resend.textContent = 'Resend code';
      } else {
        el.resend.textContent = `Resend code in ${left}s`;
      }
    }, 1000);
  };

  const clearOtp = () => {
    el.otp.forEach((input) => { input.value = ''; flagInvalid(input, false); });
  };

  const showVerify = () => {
    el.stepIdentify.hidden = true;
    el.stepVerify.hidden = false;
    el.target.textContent = shown;
    el.change.textContent = channel === 'email' ? 'Use a different email' : 'Use a different number';
    say(el.verifyStatus);
    clearOtp();
    startTimer();
    el.otp[0].focus();
  };

  el.otp.forEach((input, i) => {
    input.addEventListener('focus', () => input.select());

    input.addEventListener('input', () => {
      const digit = input.value.replace(/\D/g, '').slice(-1);
      input.value = digit;
      say(el.verifyStatus);
      el.otp.forEach((o) => flagInvalid(o, false));
      if (digit && i < el.otp.length - 1) el.otp[i + 1].focus();
      if (el.otp.every((o) => o.value)) el.verifyForm.requestSubmit();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && i > 0) {
        e.preventDefault();
        el.otp[i - 1].value = '';
        el.otp[i - 1].focus();
      } else if (e.key === 'ArrowLeft' && i > 0) {
        e.preventDefault();
        el.otp[i - 1].focus();
      } else if (e.key === 'ArrowRight' && i < el.otp.length - 1) {
        e.preventDefault();
        el.otp[i + 1].focus();
      }
    });

    input.addEventListener('paste', (e) => {
      const digits = (e.clipboardData ? e.clipboardData.getData('text') : '').replace(/\D/g, '').slice(0, el.otp.length);
      if (!digits) return;
      e.preventDefault();
      [...digits].forEach((d, k) => { el.otp[k].value = d; });
      el.otp[Math.min(digits.length, el.otp.length - 1)].focus();
      if (digits.length === el.otp.length) el.verifyForm.requestSubmit();
    });
  });

  el.verifyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (el.verifyBtn.disabled) return;

    const code = el.otp.map((o) => o.value).join('');
    if (!/^\d{6}$/.test(code)) {
      say(el.verifyStatus, 'Enter all 6 digits of the code.', 'err');
      (el.otp.find((o) => !o.value) || el.otp[0]).focus();
      return;
    }

    busy(el.verifyBtn, 'Checking…', true);
    say(el.verifyStatus);
    try {
      if (live) await post(AUTH.verifyUrl, { channel, identifier, code });
      else await delay(500);
      finish();
    } catch (err) {
      console.error('[Yukti] verify failed:', err);
      const wrong = [400, 401, 422].includes(err.status);
      say(
        el.verifyStatus,
        err.status === 429
          ? 'Too many attempts. Please wait a few minutes and try again.'
          : wrong
            ? 'That code isn’t right, or it has expired. Check it and try again.'
            : 'We couldn’t check the code. Please try again.',
        'err',
      );
      clearOtp();
      if (wrong) el.otp.forEach((o) => flagInvalid(o, true));
      el.otp[0].focus();
    } finally {
      busy(el.verifyBtn, 'Verify and log in', false);
    }
  });

  el.resend.addEventListener('click', async () => {
    el.resend.disabled = true;
    try {
      await sendCode();
      clearOtp();
      say(el.verifyStatus, 'A new code is on its way.', 'ok');
      startTimer();
      el.otp[0].focus();
    } catch (err) {
      console.error('[Yukti] resend failed:', err);
      say(el.verifyStatus, 'We couldn’t send a new code. Please try again in a moment.', 'err');
      startTimer(10);
    }
  });

  el.change.addEventListener('click', () => {
    clearInterval(timerId);
    el.stepVerify.hidden = true;
    el.stepIdentify.hidden = false;
    say(el.verifyStatus);
    (channel === 'email' ? el.email : el.phone).focus();
  });

  /* ---------- Step 3: done ---------- */
  el.restart.addEventListener('click', () => {
    el.stepDone.hidden = true;
    el.stepIdentify.hidden = false;
    el.email.value = '';
    el.phone.value = '';
    say(el.loginStatus);
    setChannel('email');
    el.email.focus();
  });

  const finish = () => {
    if (live && AUTH.redirectTo) {
      location.assign(AUTH.redirectTo);
      return;
    }
    clearInterval(timerId);
    el.stepVerify.hidden = true;
    el.stepDone.hidden = false;
    el.doneText.textContent = live
      ? `You’re logged in as ${shown}.`
      : 'Preview complete. On the live site, this is where you would land in your account.';
    el.stepDone.focus();
  };
})();
