(function () {
  const { createClient } = supabase;

  let client = null;
  let mode = 'signin';

  const PAGE = document.body.dataset.page || 'home';
  const isAppPage = PAGE === 'app';
  const isHomePage = PAGE === 'home';

  const $ = (id) => document.getElementById(id);

  const DEFAULT_ADMIN_EMAILS = [
    'aryan.238.sharma@gmail.com',
    'samarthssinghal@gmail.com',
  ];

  function getAdminEmails() {
    const list = window.ADMIN_EMAILS || DEFAULT_ADMIN_EMAILS;
    return list.map((e) => e.trim().toLowerCase());
  }

  function isAdmin(email) {
    if (!email) return false;
    return getAdminEmails().includes(email.trim().toLowerCase());
  }

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

  function getHomeUrl() {
    if (window.HOME_URL && !window.HOME_URL.includes('your-app')) {
      return window.HOME_URL;
    }
    const base = window.location.origin + '/';
    return base.endsWith('//') ? base : base.replace(/\/[^/]*$/, '/');
  }

  function getDashboardUrl() {
    if (window.DASHBOARD_URL && !window.DASHBOARD_URL.includes('your-app')) {
      return window.DASHBOARD_URL;
    }
    const dir = window.location.pathname.replace(/[^/]+$/, '');
    return window.location.origin + dir + 'dashboard.html';
  }

  function goHome() {
    window.location.href = getHomeUrl();
  }

  function goDashboard() {
    window.location.href = getDashboardUrl();
  }

  function getOAuthRedirectUrl() {
    return getDashboardUrl();
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
    if (!title) return;

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
    const loggedIn = !!(session?.user);

    if (isHomePage) {
      if (loginBtn) loginBtn.hidden = loggedIn;
      if (ctaBtn) ctaBtn.hidden = loggedIn;
    }
    if (userMenu) userMenu.hidden = !loggedIn;
    if (userEmail) userEmail.textContent = loggedIn ? (session.user.email || 'Account') : '';
  }

  function updateDashboardView(session) {
    if (!isAppPage) return;
    const adminPanel = $('adminPanel');
    if (!adminPanel) return;
    adminPanel.hidden = !isAdmin(session?.user?.email);
  }

  function handleAuthRouting(session) {
    if (session?.user) {
      if (isHomePage) goDashboard();
    } else if (isAppPage) {
      goHome();
    }
  }

  window.openModal = function () {
    if (!isHomePage) return;
    $('loginModal').classList.add('open');
    document.body.style.overflow = 'hidden';
    setMessage('');
    if (!isConfigured()) {
      setMessage('Add your Supabase keys in supabase-config.js (see supabase-config.example.js).', 'error');
    }
  };

  window.closeModal = function () {
    if (!isHomePage) return;
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
      options: { redirectTo: getOAuthRedirectUrl() },
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
          redirectTo: getDashboardUrl(),
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
          goDashboard();
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
        goDashboard();
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
    goHome();
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
      if (nav) {
        nav.style.boxShadow = window.scrollY > 20 ? '0 4px 24px rgba(26,95,168,0.1)' : 'none';
      }
    });
  }

  async function init() {
    updateNav(null);
    updateDashboardView(null);
    updateModalUI();
    bindEvents();

    const sb = getClient();
    if (!sb) return;

    const { data: { session } } = await sb.auth.getSession();
    handleAuthRouting(session);
    updateNav(session);
    updateDashboardView(session);

    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        if (isHomePage) goDashboard();
        else {
          updateNav(session);
          updateDashboardView(session);
        }
      } else if (event === 'SIGNED_OUT') {
        goHome();
      } else {
        updateNav(session);
        updateDashboardView(session);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
