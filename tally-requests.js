(function () {
  const { createClient } = supabase;

  const $ = (id) => document.getElementById(id);
  const adminState = {
    activeTab: 'requests',
    selectedRequestId: null,
    clients: [],
    session: null,
  };
  const clientState = {
    activeRequestId: null,
    session: null,
  };

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
  const SLACK_PLACEHOLDERS = ['YOUR_', 'your-', 'your_', 'example.com'];

  function isAdminEmail(email) {
    if (!email) return false;
    return ADMIN_EMAILS.includes(String(email).trim().toLowerCase());
  }

  function getConfiguredValue(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    return SLACK_PLACEHOLDERS.some((token) => text.includes(token)) ? '' : text;
  }

  function getSlackConfig() {
    return {
      relayUrl: getConfiguredValue(window.SLACK_WEBHOOK_PROXY_URL),
      workspaceUrl: getConfiguredValue(window.SLACK_WORKSPACE_URL),
      defaultChannel: String(window.SLACK_DEFAULT_CHANNEL || '').trim(),
    };
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

  function summarizeRequest(request) {
    if (!request) return null;
    return {
      id: request.id || null,
      business_name: safeText(request.business_name || 'NA'),
      status: safeText(request.status || 'pending'),
      contact_name: safeText(request.contact_name || 'NA'),
      contact_email: safeText(request.contact_email || 'NA'),
      contact_phone: safeText(request.contact_phone || 'NA'),
      current_website: safeText(request.current_website || 'NA'),
      what_they_want: safeText(request.what_they_want || 'NA'),
      created_at: request.created_at || null,
      updated_at: request.updated_at || null,
    };
  }

  function getKnownRequest(requestId) {
    if (!requestId) return null;
    if (clientState.activeRequest?.id === requestId) return clientState.activeRequest;
    return adminState.clients.find((request) => request.id === requestId) || null;
  }

  function setSlackUiStatus(text, tone, helpText) {
    const pill = $('slackStatusPill');
    const help = $('slackStatusHelp');
    if (pill) {
      pill.textContent = text;
      pill.className = `slack-status-pill slack-status-pill--${tone}`;
    }
    if (help) help.textContent = helpText;
  }

  function updateSlackUi() {
    const { relayUrl, workspaceUrl, defaultChannel } = getSlackConfig();
    const channelLabel = $('slackChannelLabel');
    const openSlackBtn = $('btnOpenSlack');
    const testBtn = $('btnSlackTest');

    if (channelLabel) {
      channelLabel.textContent = defaultChannel ? `Channel: ${defaultChannel}` : 'Channel: not set';
    }

    if (openSlackBtn) {
      openSlackBtn.hidden = !workspaceUrl;
      if (workspaceUrl) openSlackBtn.href = workspaceUrl;
    }

    if (testBtn) testBtn.disabled = !relayUrl;

    if (relayUrl) {
      setSlackUiStatus(
        'Relay configured',
        'ok',
        'Slack updates will be sent through your secure relay endpoint.'
      );
    } else {
      setSlackUiStatus(
        'Relay not configured',
        'warning',
        'Add window.SLACK_WEBHOOK_PROXY_URL after you create a secure Slack bridge on the server side.'
      );
    }
  }

  async function sendSlackEvent(eventName, payload) {
    const { relayUrl } = getSlackConfig();
    if (!relayUrl) return false;

    const response = await fetch(relayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: 'solven-dashboard',
        event: eventName,
        sent_at: new Date().toISOString(),
        payload,
      }),
    });

    if (!response.ok) {
      throw new Error(`Slack relay returned ${response.status}`);
    }

    return true;
  }

  function notifySlack(eventName, payload) {
    const { relayUrl } = getSlackConfig();
    if (!relayUrl) return;
    sendSlackEvent(eventName, payload)
      .then(() => {
        updateSlackUi();
      })
      .catch((error) => {
        setSlackUiStatus('Relay error', 'error', safeText(error.message || 'Could not reach Slack relay.'));
      });
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

  async function fetchAcceptedClients(sb) {
    const { data, error } = await sb
      .from('client_requests')
      .select('*')
      .eq('status', 'accepted')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function fetchChatMessages(sb, requestId) {
    if (!requestId) return [];
    const { data, error } = await sb
      .from('request_messages')
      .select('*')
      .eq('request_id', requestId)
      .order('created_at', { ascending: true });
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
    const chatPanel = $('clientChatPanel');

    show(formPanel, mode === 'form');
    show(pendingPanel, mode === 'pending');
    show(acceptedPanel, mode === 'accepted');
    show(deniedPanel, mode === 'denied');
    show(chatPanel, mode === 'chat');

    const pendingBusinessName = $('pendingBusinessName');
    if (pendingBusinessName) {
      pendingBusinessName.textContent = (request?.business_name && String(request.business_name).trim()) || '';
    }
  }

  async function refreshClientView(sb, session) {
    const req = await fetchActiveClientRequest(sb, session.user.id);
    clientState.activeRequest = req;
    if (!req) {
      clientState.activeRequestId = null;
      return setClientView('form', null);
    }
    if (req.status === 'pending') {
      clientState.activeRequestId = null;
      return setClientView('pending', req);
    }
    if (req.status === 'accepted') {
      clientState.activeRequestId = req.id;
      setClientView('chat', req);
      return renderClientChat(sb, session);
    }
    clientState.activeRequestId = null;
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
    const pendingById = new Map(pending.map((req) => [req.id, req]));

    list.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const action = btn.dataset.action;
        const next = action === 'accept' ? 'accepted' : 'denied';
        const request = pendingById.get(id) || null;
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
        notifySlack('client_request.status_changed', {
          previous_status: 'pending',
          request: summarizeRequest({
            ...(request || {}),
            id,
            status: next,
            updated_at: new Date().toISOString(),
          }),
          triggered_by: adminState.session?.user?.email || 'admin',
        });
        await refreshAdminView(sb);
        if (adminState.activeTab === 'clients') {
          await refreshAdminClients(sb, adminState.session);
        }
      });
    });
  }

  function renderChatMessages(container, rows, currentUserId) {
    if (!container) return;
    container.innerHTML = '';
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'chat-empty';
      empty.textContent = 'No messages yet.';
      container.appendChild(empty);
      return;
    }

    rows.forEach((row) => {
      const bubble = document.createElement('div');
      const mine = row.sender_user_id === currentUserId;
      bubble.className = `chat-message ${mine ? 'chat-message--me' : 'chat-message--other'}`;

      const text = document.createElement('div');
      text.textContent = safeText(row.message_body || '');
      bubble.appendChild(text);

      const meta = document.createElement('div');
      meta.className = 'chat-meta';
      meta.textContent = row.created_at ? new Date(row.created_at).toLocaleString() : '';
      bubble.appendChild(meta);

      container.appendChild(bubble);
    });

    container.scrollTop = container.scrollHeight;
  }

  async function renderAdminChat(sb, session) {
    const title = $('adminChatTitle');
    const box = $('adminChatMessages');
    if (!box) return;

    const selected = adminState.clients.find((x) => x.id === adminState.selectedRequestId) || null;
    if (!selected) {
      if (title) title.textContent = 'Client chat';
      box.innerHTML = '<p class="chat-empty">Select a client to open chat.</p>';
      return;
    }

    if (title) title.textContent = safeText(selected.business_name || selected.contact_name || 'Client');
    try {
      const rows = await fetchChatMessages(sb, selected.id);
      renderChatMessages(box, rows, session.user.id);
    } catch (err) {
      box.innerHTML = `<p class="chat-empty">${safeText(err.message)}</p>`;
    }
  }

  async function refreshAdminClients(sb, session) {
    const list = $('adminClientsList');
    if (!list) return;
    const clients = await fetchAcceptedClients(sb);
    adminState.clients = clients;
    list.innerHTML = '';

    if (!clients.length) {
      list.innerHTML = '<p class="chat-empty">No accepted clients yet.</p>';
      adminState.selectedRequestId = null;
      await renderAdminChat(sb, session);
      return;
    }

    if (!adminState.selectedRequestId || !clients.some((x) => x.id === adminState.selectedRequestId)) {
      adminState.selectedRequestId = clients[0].id;
    }

    clients.forEach((client) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `client-item ${adminState.selectedRequestId === client.id ? 'is-active' : ''}`;
      btn.dataset.requestId = client.id;
      btn.innerHTML = `<strong>${safeText(client.business_name || 'Client')}</strong><span>${safeText(client.contact_email || '')}</span>`;
      btn.addEventListener('click', async () => {
        if (adminState.selectedRequestId === client.id) return;
        adminState.selectedRequestId = client.id;
        list.querySelectorAll('.client-item').forEach((item) => {
          item.classList.toggle('is-active', item.dataset.requestId === client.id);
        });
        await renderAdminChat(sb, session);
      });
      list.appendChild(btn);
    });

    await renderAdminChat(sb, session);
  }

  async function sendChatMessage(sb, requestId, session, inputId) {
    const input = $(inputId);
    if (!input || !requestId) return;
    const message = input.value.trim();
    if (!message) return;

    input.disabled = true;
    try {
      const { data, error } = await sb.from('request_messages').insert({
        request_id: requestId,
        sender_user_id: session.user.id,
        message_body: message,
      }).select().single();
      if (error) throw error;
      input.value = '';
      notifySlack('request_message.created', {
        request: summarizeRequest(getKnownRequest(requestId)),
        message: {
          id: data?.id || null,
          body: message,
          created_at: data?.created_at || new Date().toISOString(),
          sender_email: session.user.email || '',
          sender_role: isAdminEmail(session.user.email) ? 'admin' : 'client',
        },
      });
    } catch (err) {
      alert(err.message || 'Failed to send message.');
    } finally {
      input.disabled = false;
      input.focus();
    }
  }

  async function dismissMyRequest(sb, requestId, session) {
    const { error } = await sb.rpc('dismiss_my_request', { request_id: requestId });
    if (error) {
      alert(error.message || 'Failed');
      return;
    }
    await refreshClientView(sb, session);
  }

  async function renderClientChat(sb, session) {
    const box = $('clientChatMessages');
    if (!box) return;
    if (!clientState.activeRequestId) {
      box.innerHTML = '<p class="chat-empty">No active chat.</p>';
      return;
    }

    try {
      const rows = await fetchChatMessages(sb, clientState.activeRequestId);
      renderChatMessages(box, rows, session.user.id);
    } catch (err) {
      box.innerHTML = `<p class="chat-empty">${safeText(err.message)}</p>`;
    }
  }

  function setAdminTab(tab) {
    adminState.activeTab = tab;
    const requestsView = $('adminRequestsView');
    const clientsView = $('adminClientsView');
    const slackView = $('adminSlackView');
    show(requestsView, tab === 'requests');
    show(clientsView, tab === 'clients');
    show(slackView, tab === 'slack');

    document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.adminTab === tab);
    });
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

        const { data, error } = await sb.from('client_requests').insert({
          user_id: session.user.id,
          business_name: tally.business_name,
          current_website: tally.current_website,
          what_they_want: tally.what_they_want,
          contact_name: tally.contact_name,
          contact_email: tally.contact_email,
          contact_phone: tally.contact_phone,
          status: 'pending',
          client_dismissed: false,
        }).select().single();

        if (error) throw error;

        notifySlack('client_request.created', {
          request: summarizeRequest(data || {
            business_name: tally.business_name,
            current_website: tally.current_website,
            what_they_want: tally.what_they_want,
            contact_name: tally.contact_name,
            contact_email: tally.contact_email,
            contact_phone: tally.contact_phone,
            status: 'pending',
          }),
          submitted_by: session.user.email || '',
        });
        await refreshClientView(sb, session);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Tally submission handling error:', err);
        alert(err.message || 'Something went wrong submitting your request.');
      }
    });
  }

  function bindAdminChatEvents(sb, session) {
    $('tabRequests')?.addEventListener('click', async () => {
      setAdminTab('requests');
      await refreshAdminView(sb);
    });
    $('tabClients')?.addEventListener('click', async () => {
      setAdminTab('clients');
      await refreshAdminClients(sb, session);
    });
    $('tabSlack')?.addEventListener('click', () => {
      setAdminTab('slack');
      updateSlackUi();
    });

    $('adminChatForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!adminState.selectedRequestId) return;
      await sendChatMessage(sb, adminState.selectedRequestId, session, 'adminChatInput');
      await renderAdminChat(sb, session);
    });

    $('btnSlackTest')?.addEventListener('click', async () => {
      const button = $('btnSlackTest');
      if (!button) return;
      button.disabled = true;
      try {
        await sendSlackEvent('integration.test', {
          message: 'Slack test from the Solven admin dashboard.',
          triggered_by: session.user.email || 'admin',
        });
        setSlackUiStatus('Test sent', 'ok', 'Your relay accepted the Slack test event.');
      } catch (error) {
        setSlackUiStatus('Relay error', 'error', safeText(error.message || 'Could not reach Slack relay.'));
      } finally {
        button.disabled = !getSlackConfig().relayUrl;
      }
    });
  }

  function bindClientChatEvents(sb, session) {
    $('clientChatForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!clientState.activeRequestId) return;
      await sendChatMessage(sb, clientState.activeRequestId, session, 'clientChatInput');
      await renderClientChat(sb, session);
    });
  }

  async function init() {
    if (!isConfigured()) return;
    const sb = createClient(normalizeUrl(window.SUPABASE_URL), window.SUPABASE_ANON_KEY);
    const session = await getSession(sb);
    if (!session?.user) return;

    const admin = isAdminEmail(session.user.email);
    adminState.session = session;
    clientState.session = session;

    // Admin or client list.
    if (admin) {
      setAdminTab('requests');
      updateSlackUi();
      bindAdminChatEvents(sb, session);
      await refreshAdminView(sb);
      await refreshAdminClients(sb, session);
      // Poll so new submissions appear without refresh.
      setInterval(async () => {
        try {
          if (adminState.activeTab === 'requests') {
            await refreshAdminView(sb);
          } else {
            await refreshAdminClients(sb, session);
          }
        } catch (_) {}
      }, 5000);
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

    bindClientChatEvents(sb, session);

    // Listen for submit and persist to Supabase.
    registerTallySubmissionListener(sb, session);

    // Render initial state from DB.
    await refreshClientView(sb, session);

    // Poll occasionally so accept/deny updates show up without refresh.
    setInterval(async () => {
      try {
        await refreshClientView(sb, session);
      } catch (_) {}
    }, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
