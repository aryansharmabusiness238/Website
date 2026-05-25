(function () {
  const { createClient } = supabase;

  let client = null;
  let mode = 'signin'; // 'signin' | 'signup' | 'forgot'

  const $ = (id) => document.getElementById(id);

  function isConfigured() {
    return (
      window.SUPABASE_URL &&
      window.SUPABASE_ANON_KEY &&
      !window.SUPABASE_URL.includes('YOUR_') &&
      !window.SUPABASE_ANON_KEY.includes('YOUR_')
    );
  }

  function normalizeUrl(url) {
    return url.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
  }

  function getClient() {
    if (!isConfigured()) return null;
    if (!client) {
      client = createClient(
        normalizeUrl(window.SUPABASE_URL),
        window.SUPABASE_ANON_KEY
      );
    }
    return client;
  }

  function setMessage(text, type) {
    const el = $('authMessage');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'auth-message' + (type ? ` auth-message--${type}` : '');
    el.hidden = !text;
  }

  function setLoading(loading) {
    ['btnGoogle', 'btnEmailAuth'].forEach((id) => {
      const btn = $(id);
      if (btn) btn.disabled = loading;
    });
  }

  function updateModalUI() {
    const title = $('authTitle');
    const subtitle = $('authSubtitle');
    const btn = $('btnEmailAuth');
    const toggle = $('toggleSignUp');
    const forgot = $('forgotPassword');
    const password = $('authPassword');

    if (mode === 'signup') {
      title.textContent = 'Create your account';
      subtitle.textContent = 'Sign up for Solven';
      btn.textContent = 'Sign Up';
      toggle.textContent = 'Already have an account? Sign in';
      forgot.hidden = true;
      password.hidden = false;
    } else if (mode === 'forgot') {
      title.textContent = 'Reset password';
      subtitle.textContent = 'We will email you a reset link';
      btn.textContent = 'Send reset link';
      toggle.textContent = 'Back to sign in';
      forgot.hidden = true;
      password.hidden = true;
    } else {
      title.textContent = 'Welcome back';
      subtitle.textContent = 'Sign in to your Solven account';
      btn.textContent = 'Sign In';
      toggle.textContent = "Don't have an account? Sign up free";
      forgot.hidden = false;
      password.hidden = false;
    }
  }

  function updateNav(session) {
    const loginBtn = $('btnLogin');
    const ctaBtn = $('btnGetStarted');
    const userMenu = $('navUserMenu');
    const userEmail = $('navUserEmail');

    if (session?.user) {
      loginBtn.hidden = true;
      ctaBtn.hidden = true;
      userMenu.hidden = false;
      userEmail.textContent = session.user.email || 'Account';
    } else {
      loginBtn.hidden = false;
      ctaBtn.hidden = false;
      userMenu.hidden = true;
    }
  }

  window.openModal = function () {
    $('loginModal').classList.add('open');
    document.body.style.overflow = 'hidden';
    setMessage('');
    if (!isConfigured()) {
      setMessage('Add your Supabase keys in supabase-config.js (see supabase-config.example.js).', 'error');
    }
  };

  window.closeModal = function () {
    $('loginModal').classList.remove('open');
    document.body.style.overflow = '';
    mode = 'signin';
    updateModalUI();
    setMessage('');
  };

  window.handleOverlayClick = function (e) {
    if (e.target === $('loginModal')) closeModal();
  };

  async function signInWithGoogle() {
    const sb = getClient();
    if (!sb) {
      setMessage('Supabase is not configured yet.', 'error');
      return;
    }
    setLoading(true);
    setMessage('');
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href.split('#')[0] },
    });
    setLoading(false);
    if (error) setMessage(error.message, 'error');
  }

  async function handleEmailAuth() {
    const sb = getClient();
    if (!sb) {
      setMessage('Supabase is not configured yet.', 'error');
      return;
    }

    const email = $('authEmail').value.trim();
    const password = $('authPassword').value;

    if (!email) {
      setMessage('Please enter your email.', 'error');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      if (mode === 'forgot') {
        const { error } = await sb.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.href.split('#')[0],
        });
        if (error) throw error;
        setMessage('Check your email for the password reset link.', 'success');
      } else if (mode === 'signup') {
        if (!password || password.length < 6) {
          setMessage('Password must be at least 6 characters.', 'error');
          return;
        }
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          setMessage('Account created. You are signed in.', 'success');
          closeModal();
        } else {
          setMessage('Check your email to confirm your account, then sign in.', 'success');
        }
      } else {
        if (!password) {
          setMessage('Please enter your password.', 'error');
          return;
        }
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        closeModal();
      }
    } catch (err) {
      setMessage(err.message || 'Something went wrong.', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    const sb = getClient();
    if (!sb) return;
    await sb.auth.signOut();
    updateNav(null);
  }

  function bindEvents() {
    $('btnGoogle')?.addEventListener('click', signInWithGoogle);
    $('btnEmailAuth')?.addEventListener('click', handleEmailAuth);
    $('btnLogout')?.addEventListener('click', signOut);

    $('toggleSignUp')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (mode === 'signup' || mode === 'forgot') mode = 'signin';
      else mode = 'signup';
      updateModalUI();
      setMessage('');
    });

    $('forgotPassword')?.addEventListener('click', (e) => {
      e.preventDefault();
      mode = mode === 'forgot' ? 'signin' : 'forgot';
      updateModalUI();
      setMessage('');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });

    window.addEventListener('scroll', () => {
      const nav = document.querySelector('nav');
      nav.style.boxShadow = window.scrollY > 20 ? '0 4px 24px rgba(26,95,168,0.1)' : 'none';
    });
  }

  async function init() {
    updateModalUI();
    bindEvents();

    const sb = getClient();
    if (!sb) return;

    const { data: { session } } = await sb.auth.getSession();
    updateNav(session);

    sb.auth.onAuthStateChange((_event, session) => {
      updateNav(session);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
