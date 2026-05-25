(function () {
  const $ = (id) => document.getElementById(id);

  function getSb() {
    return typeof getClient === 'function' ? getClient() : null;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str ?? '';
    return d.innerHTML;
  }

  function show(el, visible) {
    if (el) el.hidden = !visible;
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
    return data;
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
        <strong>${escapeHtml(req.business_name)}</strong>
        <span class="status-pill status-pill--pending">Pending</span>
      </div>
      <dl class="request-details">
        <div><dt>Contact</dt><dd>${escapeHtml(req.contact_name)}</dd></div>
        <div><dt>Email</dt><dd>${escapeHtml(req.contact_email)}</dd></div>
        <div><dt>Phone</dt><dd>${escapeHtml(req.contact_phone)}</dd></div>
        <div><dt>Current website</dt><dd>${escapeHtml(req.current_website)}</dd></div>
        <div><dt>What they want</dt><dd>${escapeHtml(req.what_they_want)}</dd></div>
        <div><dt>Submitted</dt><dd>${new Date(req.created_at).toLocaleString()}</dd></div>
      </dl>
      <div class="request-actions">
        <button type="button" class="btn-accept" data-action="accept" data-id="${req.id}">Accept</button>
        <button type="button" class="btn-deny" data-action="deny" data-id="${req.id}">Deny</button>
      </div>
    `;
    return card;
  }

  async function loadAdminRequests(session) {
    const sb = getSb();
    const list = $('adminRequestsList');
    const empty = $('adminEmpty');
    if (!sb || !list) return;

    try {
      const pending = await fetchPendingRequests(sb);
      list.innerHTML = '';
      show(empty, pending.length === 0);
      pending.forEach((req) => list.appendChild(renderAdminRequestCard(req)));

      list.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          const status = btn.dataset.action === 'accept' ? 'accepted' : 'denied';
          btn.disabled = true;
          const { error } = await sb.rpc('admin_set_request_status', {
            request_id: id,
            new_status: status,
          });
          if (error) alert(error.message);
          else await loadAdminRequests(session);
        });
      });
    } catch (err) {
      list.innerHTML = `<p class="panel-error">${escapeHtml(err.message)}</p>`;
      show(empty, true);
    }
  }

  function showClientView(request) {
    const formPanel = $('clientFormPanel');
    const pendingPanel = $('clientPendingPanel');
    const acceptedPanel = $('clientAcceptedPanel');
    const deniedPanel = $('clientDeniedPanel');

    show(formPanel, !request);
    show(pendingPanel, request?.status === 'pending');
    show(acceptedPanel, request?.status === 'accepted');
    show(deniedPanel, request?.status === 'denied');

    if (request?.status === 'pending') {
      const el = $('pendingBusinessName');
      if (el) el.textContent = request.business_name;
    }
    if (request?.status === 'accepted') {
      const btn = $('btnDismissAccepted');
      if (btn) btn.dataset.requestId = request.id;
    }
    if (request?.status === 'denied') {
      const btn = $('btnDismissDenied');
      if (btn) btn.dataset.requestId = request.id;
    }
  }

  async function loadClientDashboard(session) {
    const sb = getSb();
    if (!sb || !session?.user) return;

    try {
      const request = await fetchActiveClientRequest(sb, session.user.id);
      showClientView(request);

      const emailInput = $('fieldEmail');
      if (emailInput && session.user.email) {
        emailInput.value = session.user.email;
      }
    } catch (err) {
      const formPanel = $('clientFormPanel');
      if (formPanel) {
        formPanel.hidden = false;
        const msg = $('clientFormMessage');
        if (msg) {
          msg.textContent = err.message;
          msg.className = 'panel-message panel-message--error';
          msg.hidden = false;
        }
      }
    }
  }

  async function submitClientForm(session) {
    const sb = getSb();
    const msg = $('clientFormMessage');
    const btn = $('btnSubmitRequest');

    const payload = {
      user_id: session.user.id,
      business_name: $('fieldBusinessName').value.trim(),
      current_website: $('fieldCurrentWebsite').value.trim() || 'NA',
      what_they_want: $('fieldWhatTheyWant').value.trim(),
      contact_name: $('fieldName').value.trim(),
      contact_email: $('fieldEmail').value.trim(),
      contact_phone: $('fieldPhone').value.trim(),
      status: 'pending',
      client_dismissed: false,
    };

    if (!payload.business_name || !payload.what_they_want || !payload.contact_name ||
        !payload.contact_email || !payload.contact_phone) {
      msg.textContent = 'Please fill in all required fields.';
      msg.className = 'panel-message panel-message--error';
      msg.hidden = false;
      return;
    }

    btn.disabled = true;
    msg.hidden = true;

    try {
      const existing = await fetchActiveClientRequest(sb, session.user.id);
      if (existing?.status === 'pending') {
        msg.textContent = 'You already have a pending request.';
        msg.className = 'panel-message panel-message--error';
        msg.hidden = false;
        return;
      }

      const { error } = await sb.from('client_requests').insert(payload);
      if (error) throw error;
      await loadClientDashboard(session);
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'panel-message panel-message--error';
      msg.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  async function dismissClientNotification(requestId, session) {
    const sb = getSb();
    const { error } = await sb.rpc('dismiss_my_request', { request_id: requestId });
    if (error) alert(error.message);
    else await loadClientDashboard(session);
  }

  function bindRequestEvents(session) {
    $('clientRequestForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      submitClientForm(session);
    });

    $('btnDismissAccepted')?.addEventListener('click', async () => {
      const id = $('btnDismissAccepted').dataset.requestId;
      if (id) await dismissClientNotification(id, session);
    });

    $('btnDismissDenied')?.addEventListener('click', async () => {
      const id = $('btnDismissDenied').dataset.requestId;
      if (id) await dismissClientNotification(id, session);
    });
  }

  window.initRequests = async function (session, admin) {
    if (!session?.user) return;
    bindRequestEvents(session);

    if (admin) {
      show($('clientPanel'), false);
      show($('adminPanel'), true);
      await loadAdminRequests(session);
    } else {
      show($('adminPanel'), false);
      show($('clientPanel'), true);
      await loadClientDashboard(session);
    }
  };

  window.refreshRequests = async function (session, admin) {
    if (admin) await loadAdminRequests(session);
    else await loadClientDashboard(session);
  };
})();
