(function () {
  const { createClient } = supabase;

  const $ = (id) => document.getElementById(id);

  function normalizeUrl(url) {
    return (url || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
  }

  function isConfigured() {
    return (
      window.SUPABASE_URL &&
      window.SUPABASE_ANON_KEY &&
      !window.SUPABASE_URL.includes('YOUR_') &&
      !window.SUPABASE_ANON_KEY.includes('YOUR_')
    );
  }

  const ADMIN_EMAILS = (window.ADMIN_EMAILS || []).map((e) => String(e).trim().toLowerCase());

  function isAdminEmail(email) {
    if (!email) return false;
    return ADMIN_EMAILS.includes(String(email).trim().toLowerCase());
  }

  function show(el, visible) {
    if (!el) return;
    el.hidden = !visible;
  }

  function safeText(v) {
    if (v === null || typeof v === 'undefined') return '';
    if (Array.isArray(v)) return v.map((x) => String(x)).join(', ');
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  function getFieldValue(fields, keywords) {
    const kw = keywords.map((k) => String(k).toLowerCase());
    const hit = (fields || []).find((f) => {
      const title = safeText(f?.title).toLowerCase();
      return kw.some((k) => title.includes(k));
    });
    if (!hit) return '';
    const a = hit.answer;
    const val = a?.value ?? a?.raw ?? '';
    return safeText(val).trim();
  }

  function extractTallyData(payload) {
    const fields = payload?.fields || [];

    const business_name =
      getFieldValue(fields, ['business name']) ||
      'NA';

    const current_website =
      getFieldValue(fields, ['website link', 'website']) ||
      'NA';

    const what_they_want =
      getFieldValue(fields, ['what are you looking', 'looking to get done', 'looking to get']) ||
      getFieldValue(fields, ['what']) ||
      '';

    const contact_name = getFieldValue(fields, ['your name', 'name']) || 'NA';
    const contact_email = getFieldValue(fields, ['email']) || 'NA';
    const contact_phone = getFieldValue(fields, ['phone']) || 'NA';

    // Defensive: our DB requires non-null strings for these columns.
    return {
      business_name: business_name || 'NA',
      current_website: current_website || 'NA',
      what_they_want: what_they_want || 'NA',
      contact_name: contact_name || 'NA',
      contact_email: contact_email || 'NA',
      contact_phone: contact_phone || 'NA',
    };
  }

  async function getSession(sb) {
    const { data } = await sb.auth.getSession();
    return data?.session || null;
  }

  async function fetchActiveClientRequest(sb, userId) {
    const { data, error } = await sb
      .from('client_requests')
      .select('*')
      .eq('user_id', userId)
      .eq('client_dismissed', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function fetchPendingRequests(sb) {
    const { data, error } = await sb
      .from('client_requests')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  function renderAdminRequestCard(req) {
    const card = document.createElement('article');
    card.className = 'request-card';

    card.innerHTML = `
      <div class="request-card-header">
        <strong>${req.business_name ? safeText(req.business_name) : 'Business'}</strong>
        <span class="status-pill status-pill--pending">Pending</span>
      </div>
      <dl class="request-details">
        <div><dt>Current website</dt><dd>${safeText(req.current_website || 'NA')}</dd></div>
        <div><dt>What they want</dt><dd>${safeText(req.what_they_want || 'NA')}</dd></div>
        <div><dt>Contact</dt><dd>${safeText(req.contact_name || 'NA')} (${safeText(req.contact_email || 'NA')})</dd></div>
        <div><dt>Phone</dt><dd>${safeText(req.contact_phone || 'NA')}</dd></div>
        <div><dt>Submitted</dt><dd>${req.created_at ? new Date(req.created_at).toLocaleString() : ''}</dd></div>
      </dl>
      <div class="request-actions">
        <button type="button" class="btn-accept" data-action="accept" data-id="${req.id}">Accept</button>
        <button type="button" class="btn-deny" data-action="deny" data-id="${req.id}">Deny</button>
      </div>
    `;

    return card;
  }

  function setClientView(mode, request) {
    const formPanel = $('clientFormPanel');
    const pendingPanel = $('clientPendingPanel');
    const acceptedPanel = $('clientAcceptedPanel');
    const deniedPanel = $('clientDeniedPanel');

    show(formPanel, mode === 'form');
    show(pendingPanel, mode === 'pending');
    show(acceptedPanel, mode === 'accepted');
    show(deniedPanel, mode === 'denied');

    const pendingBusinessName = $('pendingBusinessName');
    if (pendingBusinessName) {
      pendingBusinessName.textContent = (request?.business_name && String(request.business_name).trim()) || '';
    }
  }

  async function refreshClientView(sb, session) {
    const req = await fetchActiveClientRequest(sb, session.user.id);
    if (!req) return setClientView('form', null);
    if (req.status === 'pending') return setClientView('pending', req);
    if (req.status === 'accepted') return setClientView('accepted', req);
    if (req.status === 'denied') return setClientView('denied', req);
    return setClientView('form', null);
  }

  async function refreshAdminView(sb) {
    const list = $('adminRequestsList');
    const empty = $('adminEmpty');
    if (!list || !empty) return;

    const pending = await fetchPendingRequests(sb);
    list.innerHTML = '';
    show(empty, pending.length === 0);
    pending.forEach((req) => list.appendChild(renderAdminRequestCard(req)));

    list.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const action = btn.dataset.action;
        const next = action === 'accept' ? 'accepted' : 'denied';
        btn.disabled = true;
        const { error } = await sb.rpc('admin_set_request_status', {
          request_id: id,
          new_status: next,
        });
        if (error) {
          alert(error.message || 'Failed');
          btn.disabled = false;
          return;
        }
        await refreshAdminView(sb);
      });
    });
  }

  async function dismissMyRequest(sb, requestId, session) {
    const { error } = await sb.rpc('dismiss_my_request', { request_id: requestId });
    if (error) {
      alert(error.message || 'Failed');
      return;
    }
    await refreshClientView(sb, session);
  }

  function registerTallySubmissionListener(sb, session) {
    const alreadyHandled = new Set();

    window.addEventListener('message', async (event) => {
      try {
        let parsed = null;

        if (typeof event.data === 'string' && event.data.includes('Tally.FormSubmitted')) {
          parsed = JSON.parse(event.data);
        } else if (event?.data && typeof event.data === 'object' && (event.data.event === 'Tally.FormSubmitted' || event.data.type === 'Tally.FormSubmitted')) {
          parsed = event.data;
        } else if (typeof event.data === 'object' && event.data !== null && String(event.data).includes('Tally.FormSubmitted')) {
          // Best-effort fallback; avoid crashing on unknown shapes.
          return;
        }

        if (!parsed?.payload) return;

        const payload = parsed.payload;
        const formId = payload?.formId || payload?.form_id;

        // Only react to this specific form.
        if (formId && String(formId) !== '9qo0kG') return;

        const submissionId = payload?.id || payload?.responseId || payload?.submissionId;
        if (submissionId && alreadyHandled.has(submissionId)) return;
        if (submissionId) alreadyHandled.add(submissionId);

        const existing = await fetchActiveClientRequest(sb, session.user.id);
        if (existing?.status === 'pending' && existing?.client_dismissed === false) {
          // Already recorded a pending request for this account.
          await refreshClientView(sb, session);
          return;
        }

        const tally = extractTallyData(payload);

        const { error } = await sb.from('client_requests').insert({
          user_id: session.user.id,
          business_name: tally.business_name,
          current_website: tally.current_website,
          what_they_want: tally.what_they_want,
          contact_name: tally.contact_name,
          contact_email: tally.contact_email,
          contact_phone: tally.contact_phone,
          status: 'pending',
          client_dismissed: false,
        });

        if (error) throw error;

        await refreshClientView(sb, session);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Tally submission handling error:', err);
        alert(err.message || 'Something went wrong submitting your request.');
      }
    });
  }

  async function init() {
    if (!isConfigured()) return;
    const sb = createClient(normalizeUrl(window.SUPABASE_URL), window.SUPABASE_ANON_KEY);
    const session = await getSession(sb);
    if (!session?.user) return;

    const admin = isAdminEmail(session.user.email);

    // Admin or client list.
    if (admin) {
      await refreshAdminView(sb);
      return;
    }

    // Hook up dismiss buttons.
    const dismissAcceptedBtn = $('btnDismissAccepted');
    const dismissDeniedBtn = $('btnDismissDenied');
    if (dismissAcceptedBtn) {
      dismissAcceptedBtn.addEventListener('click', async () => {
        const active = await fetchActiveClientRequest(sb, session.user.id);
        if (active?.id) await dismissMyRequest(sb, active.id, session);
      });
    }
    if (dismissDeniedBtn) {
      dismissDeniedBtn.addEventListener('click', async () => {
        const active = await fetchActiveClientRequest(sb, session.user.id);
        if (active?.id) await dismissMyRequest(sb, active.id, session);
      });
    }

    // Listen for submit and persist to Supabase.
    registerTallySubmissionListener(sb, session);

    // Render initial state from DB.
    await refreshClientView(sb, session);

    // Poll occasionally so accept/deny updates show up without refresh.
    setInterval(() => refreshClientView(sb, session).catch(() => {}), 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

