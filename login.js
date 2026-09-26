(() => {
  'use strict';

  /* -------------------------------------------------------------------------
     How this section works

     1. LAUNCH LIST (default, nothing to set up)
        A visitor leaves an email address or a mobile number. On a Netlify site
        it is saved by Netlify Forms under the name "yukti-signup". You read the
        entries in Netlify: open the project, then the Forms tab.

     2. REAL LOG IN (later)
        Set BOTH sendUrl and verifyUrl below and the section turns into a
        one-time-code login. The code has to be created, sent and checked by a
        server, which then answers these JSON POST requests:

          sendUrl    { channel: 'email' | 'phone', identifier }   -> 2xx once the code is sent
          verifyUrl  { channel, identifier, code }                -> 2xx if the code is right
                     (400 / 401 / 422 for a wrong code, 429 for too many tries;
                      the server sets the session in an HttpOnly cookie)
          redirectTo where to send people after a successful log in

        Good fits: Firebase Auth, Supabase Auth, or your own API with an SMS
        provider such as MSG91 or Twilio for phone codes.

     These values are visible to anyone who views the page source, so never
     put a secret key here. You can also set window.YUKTI_CONFIG before this
     script loads to override any of them.
     ------------------------------------------------------------------------- */
  const CONFIG = {
    sendUrl: '',
    verifyUrl: '',
    redirectTo: '',
    formName: 'yukti-signup',
    simulate: null, // null = automatic: preview only on localhost or a local file, real on a live site
    ...window.YUKTI_CONFIG,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  if (!$('.login-card')) return;

  const isLocal = ['', 'localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const simulate = CONFIG.simulate === null ? isLocal : Boolean(CONFIG.simulate);
  const live = Boolean(CONFIG.sendUrl && CONFIG.verifyUrl);

  const el = {
    title: $('#login-title'),
    lede: $('#login-lede'),
    note: $('#mode-note'),
    privacy: $('#privacy-note'),
    tabs: $('.tabs'),
    tabEmail: $('#tab-email'),
    tabPhone: $('#tab-phone'),
    panelEmail: $('#panel-email'),
    panelPhone: $('#panel-phone'),
    stepIdentify: $('#step-identify'),
    stepVerify: $('#step-verify'),
    stepDone: $('#step-done'),
    form: $('#login-form'),
    channelField: $('#login-channel'),
    honeypot: $('#bot-field'),
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
    doneTitle: $('#done-title'),
    doneText: $('#done-text'),
  };

  const sendLabel = live ? 'Send code' : 'Notify me';

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

  /* ---------- Wording for the current mode ---------- */
  if (live) {
    el.title.innerHTML = 'Log in. <em>No password.</em>';
    el.lede.textContent = 'A one-time code is all it takes. Choose how you’d like to receive it.';
    el.privacy.hidden = true;
    el.restart.textContent = 'Log in with another account';
    el.sendBtn.querySelector('span').textContent = sendLabel;
  } else if (simulate) {
    el.note.hidden = false;
    el.note.textContent = 'Preview mode: nothing is saved here. On the live site your details are sent to Yukti.';
  }

  /* ---------- Email / phone tabs ---------- */
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
      if (!el.stepIdentify.hidden) {
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

  /* ---------- Saving a visitor to the launch list (Netlify Forms) ---------- */
  const saveContact = async () => {
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
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
  };

  const finishSignup = () => {
    el.stepIdentify.hidden = true;
    el.stepDone.hidden = false;
    el.doneTitle.textContent = 'You’re on the list';
    el.doneText.textContent = `We’ll contact you at ${shown} the day Yukti launches.${simulate ? ' Preview only: nothing was saved.' : ''}`;
    el.stepDone.focus();
  };

  /* ---------- Step 1: submit the details ---------- */
  el.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (el.honeypot.value) return; // only bots fill this hidden field in

    const entry = readIdentifier();
    if (entry.error) {
      flagInvalid(entry.field, true);
      say(el.loginStatus, entry.error, 'err');
      entry.field.focus();
      return;
    }

    identifier = entry.id;
    shown = entry.mask;
    busy(el.sendBtn, live ? 'Sending code…' : 'Saving…', true);
    say(el.loginStatus);
    try {
      if (live) {
        await post(CONFIG.sendUrl, { channel, identifier });
        showVerify();
      } else {
        await saveContact();
        finishSignup();
      }
    } catch (err) {
      console.error('[Yukti] submit failed:', err);
      say(
        el.loginStatus,
        err.status === 429
          ? 'Too many requests. Please wait a few minutes and try again.'
          : live
            ? 'We couldn’t send the code. Check your details and try again.'
            : 'We couldn’t save your details just now. Please try again in a moment.',
        'err',
      );
    } finally {
      busy(el.sendBtn, sendLabel, false);
    }
  });

  /* ---------- Step 2 (real log in only): enter the code ---------- */
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
    if (!live || el.verifyBtn.disabled) return;

    const code = el.otp.map((o) => o.value).join('');
    if (!/^\d{6}$/.test(code)) {
      say(el.verifyStatus, 'Enter all 6 digits of the code.', 'err');
      (el.otp.find((o) => !o.value) || el.otp[0]).focus();
      return;
    }

    busy(el.verifyBtn, 'Checking…', true);
    say(el.verifyStatus);
    try {
      await post(CONFIG.verifyUrl, { channel, identifier, code });
      finishLogin();
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
      await post(CONFIG.sendUrl, { channel, identifier });
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

  /* ---------- Finished ---------- */
  const finishLogin = () => {
    if (CONFIG.redirectTo) {
      location.assign(CONFIG.redirectTo);
      return;
    }
    clearInterval(timerId);
    el.stepVerify.hidden = true;
    el.stepDone.hidden = false;
    el.doneTitle.textContent = 'You’re logged in';
    el.doneText.textContent = `You’re logged in as ${shown}.`;
    el.stepDone.focus();
  };

  el.restart.addEventListener('click', () => {
    el.stepDone.hidden = true;
    el.stepIdentify.hidden = false;
    el.email.value = '';
    el.phone.value = '';
    say(el.loginStatus);
    setChannel('email');
    el.email.focus();
  });
})();
