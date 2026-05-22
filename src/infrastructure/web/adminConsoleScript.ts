export const ADMIN_CONSOLE_SCRIPT = `(() => {
      const state = {
        qrEventSource: null,
        logEventSource: null,
        commandUsageRaw: [],
        currentQrObjectUrl: '',
        autoRefreshTimer: null,
      };

      const ui = {
        globalNotice: document.getElementById('globalNotice'),
        connectionBadge: document.getElementById('connectionBadge'),
        refreshAllBtn: document.getElementById('refreshAllBtn'),

        statusValue: document.getElementById('statusValue'),
        connectedValue: document.getElementById('connectedValue'),
        qrValue: document.getElementById('qrValue'),
        userValue: document.getElementById('userValue'),
        refreshStatusBtn: document.getElementById('refreshStatusBtn'),

        qrImage: document.getElementById('qrImage'),
        qrState: document.getElementById('qrState'),
        refreshQrBtn: document.getElementById('refreshQrBtn'),
        toggleQrStreamBtn: document.getElementById('toggleQrStreamBtn'),

        summaryStatusValue: document.getElementById('summaryStatusValue'),
        summaryMongoValue: document.getElementById('summaryMongoValue'),
        summaryUptimeValue: document.getElementById('summaryUptimeValue'),
        summaryLogsValue: document.getElementById('summaryLogsValue'),

        opsUptimeValue: document.getElementById('opsUptimeValue'),
        opsPidValue: document.getElementById('opsPidValue'),
        opsMemoryValue: document.getElementById('opsMemoryValue'),
        opsNodeValue: document.getElementById('opsNodeValue'),
        opsMongoValue: document.getElementById('opsMongoValue'),
        opsStreamsValue: document.getElementById('opsStreamsValue'),
        opsLogBufferValue: document.getElementById('opsLogBufferValue'),
        opsBotStatusValue: document.getElementById('opsBotStatusValue'),
        opsConfigValue: document.getElementById('opsConfigValue'),
        opsMaintenanceValue: document.getElementById('opsMaintenanceValue'),
        opsUpdatedValue: document.getElementById('opsUpdatedValue'),
        opsUpdatedByValue: document.getElementById('opsUpdatedByValue'),
        refreshOpsBtn: document.getElementById('refreshOpsBtn'),

        messageForm: document.getElementById('messageForm'),
        messageJid: document.getElementById('messageJid'),
        messageText: document.getElementById('messageText'),
        messageFeedback: document.getElementById('messageFeedback'),

        usageSearch: document.getElementById('usageSearch'),
        usageTableBody: document.getElementById('usageTableBody'),
        usageMeta: document.getElementById('usageMeta'),
        refreshUsageBtn: document.getElementById('refreshUsageBtn'),

        leaderboardGame: document.getElementById('leaderboardGame'),
        leaderboardLimit: document.getElementById('leaderboardLimit'),
        refreshLeaderboardBtn: document.getElementById('refreshLeaderboardBtn'),
        leaderboardBody: document.getElementById('leaderboardBody'),
        leaderboardMeta: document.getElementById('leaderboardMeta'),

        configForm: document.getElementById('configForm'),
        cfgName: document.getElementById('cfgName'),
        cfgPrefix: document.getElementById('cfgPrefix'),
        cfgAltPrefixes: document.getElementById('cfgAltPrefixes'),
        cfgMaxSessions: document.getElementById('cfgMaxSessions'),
        cfgSessionTimeout: document.getElementById('cfgSessionTimeout'),
        cfgAllowFromMe: document.getElementById('cfgAllowFromMe'),
        cfgAllowMentionPrefix: document.getElementById('cfgAllowMentionPrefix'),
        cfgDisableWarning: document.getElementById('cfgDisableWarning'),
        cfgMaintenanceMode: document.getElementById('cfgMaintenanceMode'),
        resetConfigBtn: document.getElementById('resetConfigBtn'),
        configFeedback: document.getElementById('configFeedback'),

        roleForm: document.getElementById('roleForm'),
        roleAction: document.getElementById('roleAction'),
        roleType: document.getElementById('roleType'),
        roleUserJid: document.getElementById('roleUserJid'),
        roleFeedback: document.getElementById('roleFeedback'),

        logLevel: document.getElementById('logLevel'),
        logQuery: document.getElementById('logQuery'),
        refreshLogsBtn: document.getElementById('refreshLogsBtn'),
        toggleLogStreamBtn: document.getElementById('toggleLogStreamBtn'),
        clearLogViewBtn: document.getElementById('clearLogViewBtn'),
        clearLogBufferBtn: document.getElementById('clearLogBufferBtn'),
        logsOutput: document.getElementById('logsOutput'),
        logsMeta: document.getElementById('logsMeta'),
      };

      let noticeTimer = 0;

      function showNotice(message, kind) {
        if (!ui.globalNotice) return;
        window.clearTimeout(noticeTimer);
        ui.globalNotice.className = 'notice show';
        if (kind === 'success') ui.globalNotice.classList.add('success');
        if (kind === 'error') ui.globalNotice.classList.add('error');
        ui.globalNotice.textContent = message;
        noticeTimer = window.setTimeout(() => {
          ui.globalNotice.className = 'notice';
          ui.globalNotice.textContent = '';
        }, 4600);
      }

      function setText(node, value) {
        if (node) node.textContent = String(value);
      }

      function setChip(status) {
        if (!ui.connectionBadge) return;
        ui.connectionBadge.className = 'chip';
        if (status) ui.connectionBadge.classList.add(status);
        const labels = {
          connected: 'Connected',
          qr_ready: 'QR Ready',
          disconnected: 'Disconnected',
          unavailable: 'Unavailable',
          error: 'Error',
        };
        setText(ui.connectionBadge, labels[status] || status || 'Unknown');
      }

      function formatDate(value) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString();
      }

      function formatBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes < 0) return '-';

        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let value = bytes;
        let unitIndex = 0;

        while (value >= 1024 && unitIndex < units.length - 1) {
          value /= 1024;
          unitIndex += 1;
        }

        return value.toFixed(unitIndex === 0 ? 0 : 1) + ' ' + units[unitIndex];
      }

      function readJsonError(payload, fallback) {
        if (payload && typeof payload === 'object' && payload.error) {
          return String(payload.error);
        }
        return fallback;
      }

      async function api(path, options) {
        const opts = Object.assign({}, options || {});
        const headers = Object.assign({}, opts.headers || {});

        if (opts.body && typeof opts.body !== 'string') {
          headers['Content-Type'] = 'application/json';
          opts.body = JSON.stringify(opts.body);
        }

        opts.headers = headers;

        const response = await fetch(path, opts);
        const contentType = response.headers.get('content-type') || '';
        const isJson = contentType.includes('application/json');
        const payload = isJson
          ? await response.json().catch(() => null)
          : await response.text().catch(() => '');

        if (!response.ok) {
          throw new Error(readJsonError(payload, 'Request failed') + ' (' + response.status + ')');
        }

        return payload;
      }

      async function loadStatus() {
        const data = await api('/api/status');
        setText(ui.statusValue, data.status || '-');
        setText(ui.connectedValue, data.connected ? 'yes' : 'no');
        setText(ui.qrValue, data.hasQR ? 'yes' : 'no');
        setText(ui.userValue, data.user && data.user.id ? data.user.id : '-');
        setChip(data.status || 'unavailable');
        setText(ui.summaryStatusValue, data.status || '-');
      }

      function clearQrObjectUrl() {
        if (state.currentQrObjectUrl) {
          URL.revokeObjectURL(state.currentQrObjectUrl);
          state.currentQrObjectUrl = '';
        }
      }

      async function loadQrImage() {
        const response = await fetch('/api/qr?ts=' + Date.now(), { cache: 'no-store' });
        if (!response.ok) {
          clearQrObjectUrl();
          if (ui.qrImage) ui.qrImage.removeAttribute('src');
          setText(ui.qrState, 'No active QR code.');
          return;
        }

        const blob = await response.blob();
        clearQrObjectUrl();
        state.currentQrObjectUrl = URL.createObjectURL(blob);
        if (ui.qrImage) ui.qrImage.src = state.currentQrObjectUrl;
        setText(ui.qrState, 'QR code available.');
      }

      async function loadOpsSummary() {
        const data = await api('/api/ops');

        if (ui.opsUptimeValue) ui.opsUptimeValue.textContent = data.process && data.process.uptimeText ? String(data.process.uptimeText) : '-';
        if (ui.opsPidValue) ui.opsPidValue.textContent = data.process && data.process.pid ? String(data.process.pid) : '-';

        const memory = data.process && data.process.memory ? data.process.memory : null;
        if (ui.opsMemoryValue) {
          if (memory) {
            ui.opsMemoryValue.textContent = [formatBytes(memory.rss), formatBytes(memory.heapUsed)].join(' / ');
          } else {
            ui.opsMemoryValue.textContent = '-';
          }
        }

        if (ui.opsNodeValue) ui.opsNodeValue.textContent = data.process && data.process.nodeVersion ? String(data.process.nodeVersion) : '-';
        const mongoStatus = data.mongo && data.mongo.connected ? 'connected' : 'disconnected';
        if (ui.opsMongoValue) ui.opsMongoValue.textContent = mongoStatus;
        if (ui.opsStreamsValue) {
          const qr = data.streams && Number.isFinite(Number(data.streams.qr)) ? Number(data.streams.qr) : 0;
          const logs = data.streams && Number.isFinite(Number(data.streams.logs)) ? Number(data.streams.logs) : 0;
          ui.opsStreamsValue.textContent = 'QR ' + qr + ' / Logs ' + logs;
        }
        if (ui.opsLogBufferValue) {
          const buffered = data.logs && Number.isFinite(Number(data.logs.buffered)) ? Number(data.logs.buffered) : 0;
          const capacity = data.logs && Number.isFinite(Number(data.logs.capacity)) ? Number(data.logs.capacity) : 0;
          ui.opsLogBufferValue.textContent = buffered + ' / ' + capacity;
        }
        if (ui.opsBotStatusValue) ui.opsBotStatusValue.textContent = data.bot && data.bot.status ? String(data.bot.status) : '-';
        if (ui.opsConfigValue) {
          const name = data.config && data.config.name ? String(data.config.name) : '-';
          const prefix = data.config && data.config.prefix ? String(data.config.prefix) : '-';
          ui.opsConfigValue.textContent = name + ' / ' + prefix;
        }
        if (ui.opsMaintenanceValue) ui.opsMaintenanceValue.textContent = data.config && data.config.maintenanceMode ? 'enabled' : 'disabled';
        if (ui.opsUpdatedValue) ui.opsUpdatedValue.textContent = data.config && data.config.lastUpdated ? formatDate(data.config.lastUpdated) : '-';
        if (ui.opsUpdatedByValue) ui.opsUpdatedByValue.textContent = data.config && data.config.updatedBy ? String(data.config.updatedBy) : '-';
        if (ui.summaryMongoValue) ui.summaryMongoValue.textContent = mongoStatus;
        if (ui.summaryUptimeValue) ui.summaryUptimeValue.textContent = data.process && data.process.uptimeText ? String(data.process.uptimeText) : '-';
        if (ui.summaryLogsValue) {
          const buffered = data.logs && Number.isFinite(Number(data.logs.buffered)) ? Number(data.logs.buffered) : 0;
          const capacity = data.logs && Number.isFinite(Number(data.logs.capacity)) ? Number(data.logs.capacity) : 0;
          ui.summaryLogsValue.textContent = buffered + ' / ' + capacity;
        }
      }

      function stopQrStream() {
        if (state.qrEventSource) {
          state.qrEventSource.close();
          state.qrEventSource = null;
        }
        if (ui.toggleQrStreamBtn) {
          ui.toggleQrStreamBtn.textContent = 'Start Live QR';
        }
      }

      function startQrStream() {
        stopQrStream();
        const source = new EventSource('/api/qr/stream');
        state.qrEventSource = source;

        if (ui.toggleQrStreamBtn) {
          ui.toggleQrStreamBtn.textContent = 'Stop Live QR';
        }

        source.onmessage = async (event) => {
          try {
            const payload = JSON.parse(event.data || '{}');
            if (payload.type === 'new_qr' || payload.type === 'status' || payload.type === 'connected' || payload.type === 'disconnected') {
              await loadStatus();
              await loadQrImage();
            }
          } catch (_) {
            // Ignore malformed events
          }
        };

        source.onerror = () => {
          stopQrStream();
          showNotice('QR live stream disconnected.', 'error');
        };
      }

      function aggregateUsage(rows) {
        const map = new Map();
        rows.forEach((row) => {
          const command = row && row.command ? String(row.command) : 'unknown';
          const count = Number(row && row.count ? row.count : 0);
          const user = row && row.user ? String(row.user) : '';
          const lastUsed = row && row.lastUsed ? new Date(row.lastUsed) : null;

          if (!map.has(command)) {
            map.set(command, {
              command,
              totalCalls: 0,
              users: new Set(),
              lastUsed: null,
            });
          }

          const target = map.get(command);
          target.totalCalls += Number.isFinite(count) ? count : 0;
          if (user) target.users.add(user);
          if (lastUsed && !Number.isNaN(lastUsed.getTime())) {
            if (!target.lastUsed || lastUsed > target.lastUsed) {
              target.lastUsed = lastUsed;
            }
          }
        });

        return Array.from(map.values()).sort((a, b) => b.totalCalls - a.totalCalls);
      }

      function renderUsage() {
        if (!ui.usageTableBody) return;

        const query = (ui.usageSearch && ui.usageSearch.value ? ui.usageSearch.value : '').trim().toLowerCase();
        const data = aggregateUsage(state.commandUsageRaw).filter((item) => {
          if (!query) return true;
          return item.command.toLowerCase().includes(query);
        });

        ui.usageTableBody.innerHTML = '';

        if (data.length === 0) {
          const tr = document.createElement('tr');
          const td = document.createElement('td');
          td.colSpan = 4;
          td.className = 'muted';
          td.textContent = 'No usage data found.';
          tr.appendChild(td);
          ui.usageTableBody.appendChild(tr);
          setText(ui.usageMeta, 'No command usage available.');
          return;
        }

        data.forEach((entry) => {
          const tr = document.createElement('tr');

          const commandTd = document.createElement('td');
          commandTd.className = 'mono';
          commandTd.textContent = entry.command;

          const callsTd = document.createElement('td');
          callsTd.textContent = String(entry.totalCalls);

          const usersTd = document.createElement('td');
          usersTd.textContent = String(entry.users.size);

          const lastUsedTd = document.createElement('td');
          lastUsedTd.textContent = entry.lastUsed ? formatDate(entry.lastUsed.toISOString()) : '-';

          tr.appendChild(commandTd);
          tr.appendChild(callsTd);
          tr.appendChild(usersTd);
          tr.appendChild(lastUsedTd);
          ui.usageTableBody.appendChild(tr);
        });

        setText(ui.usageMeta, data.length + ' commands loaded. Updated at ' + formatDate(new Date().toISOString()));
      }

      async function loadCommandUsage() {
        const rows = await api('/api/command-usage');
        state.commandUsageRaw = Array.isArray(rows) ? rows : [];
        renderUsage();
      }

      async function loadLeaderboard() {
        if (!ui.leaderboardBody) return;

        const game = ui.leaderboardGame && ui.leaderboardGame.value ? ui.leaderboardGame.value : 'hangman';
        const limitRaw = Number.parseInt(ui.leaderboardLimit && ui.leaderboardLimit.value ? ui.leaderboardLimit.value : '10', 10);
        const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 10, 50));

        const rows = await api('/api/leaderboard?game=' + encodeURIComponent(game) + '&limit=' + encodeURIComponent(String(limit)));
        const data = (Array.isArray(rows) ? rows : []).slice(0, limit);

        ui.leaderboardBody.innerHTML = '';

        if (data.length === 0) {
          const tr = document.createElement('tr');
          const td = document.createElement('td');
          td.colSpan = 4;
          td.className = 'muted';
          td.textContent = 'No leaderboard entries for this game.';
          tr.appendChild(td);
          ui.leaderboardBody.appendChild(tr);
          setText(ui.leaderboardMeta, 'No leaderboard data found.');
          return;
        }

        data.forEach((row) => {
          const tr = document.createElement('tr');

          const userTd = document.createElement('td');
          userTd.className = 'mono';
          userTd.textContent = row.user || '-';

          const scoreTd = document.createElement('td');
          scoreTd.textContent = String(row.score ?? 0);

          const wldTd = document.createElement('td');
          const wins = Number(row.wins ?? 0);
          const losses = Number(row.losses ?? 0);
          const draws = Number(row.draws ?? 0);
          wldTd.textContent = wins + ' / ' + losses + ' / ' + draws;

          const lastTd = document.createElement('td');
          lastTd.textContent = row.lastPlayed ? formatDate(row.lastPlayed) : '-';

          tr.appendChild(userTd);
          tr.appendChild(scoreTd);
          tr.appendChild(wldTd);
          tr.appendChild(lastTd);
          ui.leaderboardBody.appendChild(tr);
        });

        setText(ui.leaderboardMeta, data.length + ' rows for game "' + game + '".');
      }

      function parseAltPrefixes(raw) {
        return String(raw || '')
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0);
      }

      async function loadConfig() {
        const config = await api('/api/config');

        if (ui.cfgName) ui.cfgName.value = config.name || '';
        if (ui.cfgPrefix) ui.cfgPrefix.value = config.prefix || '!';
        if (ui.cfgAltPrefixes) {
          const prefixes = Array.isArray(config.alternativePrefixes) ? config.alternativePrefixes : [];
          ui.cfgAltPrefixes.value = prefixes.join(', ');
        }
        if (ui.cfgMaxSessions) ui.cfgMaxSessions.value = String(config.maxSessions ?? 5);
        if (ui.cfgSessionTimeout) ui.cfgSessionTimeout.value = String(config.sessionTimeout ?? 3600000);
        if (ui.cfgAllowFromMe) ui.cfgAllowFromMe.checked = Boolean(config.allowFromMe);
        if (ui.cfgAllowMentionPrefix) ui.cfgAllowMentionPrefix.checked = Boolean(config.allowMentionPrefix);
        if (ui.cfgDisableWarning) ui.cfgDisableWarning.checked = Boolean(config.disableWarning);
        if (ui.cfgMaintenanceMode) ui.cfgMaintenanceMode.checked = Boolean(config.maintenanceMode);
      }

      function buildConfigPayload() {
        const maxSessions = Number.parseInt(ui.cfgMaxSessions && ui.cfgMaxSessions.value ? ui.cfgMaxSessions.value : '0', 10);
        const sessionTimeout = Number.parseInt(ui.cfgSessionTimeout && ui.cfgSessionTimeout.value ? ui.cfgSessionTimeout.value : '0', 10);

        if (!Number.isFinite(maxSessions) || maxSessions < 1) {
          throw new Error('Max sessions must be a positive number.');
        }

        if (!Number.isFinite(sessionTimeout) || sessionTimeout < 1000) {
          throw new Error('Session timeout must be at least 1000 ms.');
        }

        return {
          name: ui.cfgName && ui.cfgName.value ? ui.cfgName.value.trim() : '',
          prefix: ui.cfgPrefix && ui.cfgPrefix.value ? ui.cfgPrefix.value.trim() : '!',
          alternativePrefixes: parseAltPrefixes(ui.cfgAltPrefixes && ui.cfgAltPrefixes.value ? ui.cfgAltPrefixes.value : ''),
          maxSessions,
          sessionTimeout,
          allowFromMe: Boolean(ui.cfgAllowFromMe && ui.cfgAllowFromMe.checked),
          allowMentionPrefix: Boolean(ui.cfgAllowMentionPrefix && ui.cfgAllowMentionPrefix.checked),
          disableWarning: Boolean(ui.cfgDisableWarning && ui.cfgDisableWarning.checked),
          maintenanceMode: Boolean(ui.cfgMaintenanceMode && ui.cfgMaintenanceMode.checked),
        };
      }

      async function saveConfig(event) {
        event.preventDefault();
        const payload = buildConfigPayload();
        await api('/api/config', { method: 'POST', body: payload });
        setText(ui.configFeedback, 'Configuration saved at ' + formatDate(new Date().toISOString()));
        showNotice('Configuration updated successfully.', 'success');
        await Promise.all([loadConfig(), loadStatus()]);
      }

      async function resetConfig() {
        const confirmed = window.confirm('Reset configuration to defaults?');
        if (!confirmed) return;

        await api('/api/config/reset', { method: 'POST' });
        setText(ui.configFeedback, 'Configuration reset to defaults.');
        showNotice('Configuration reset completed.', 'success');
        await Promise.all([loadConfig(), loadStatus()]);
      }

      async function submitRoleChange(event) {
        event.preventDefault();
        const action = ui.roleAction && ui.roleAction.value ? ui.roleAction.value : 'add';
        const role = ui.roleType && ui.roleType.value ? ui.roleType.value : 'admin';
        const userJid = ui.roleUserJid && ui.roleUserJid.value ? ui.roleUserJid.value.trim() : '';

        if (!userJid) {
          throw new Error('User JID is required.');
        }

        await api('/api/config/roles/' + encodeURIComponent(action), {
          method: 'POST',
          body: { userJid, role },
        });

        setText(ui.roleFeedback, 'Role update applied for ' + userJid + '.');
        showNotice('Role update succeeded.', 'success');
      }

      async function submitMessage(event) {
        event.preventDefault();
        const jid = ui.messageJid && ui.messageJid.value ? ui.messageJid.value.trim() : '';
        const text = ui.messageText && ui.messageText.value ? ui.messageText.value.trim() : '';

        if (!jid || !text) {
          throw new Error('Both JID and message are required.');
        }

        await api('/api/send-message', {
          method: 'POST',
          body: { jid, text },
        });

        setText(ui.messageFeedback, 'Message sent at ' + formatDate(new Date().toISOString()));
        showNotice('Message dispatched successfully.', 'success');
      }

      function appendLogEntry(entry, preserveScroll) {
        if (!ui.logsOutput || !entry) return;

        const shouldStickToBottom = preserveScroll
          ? ui.logsOutput.scrollTop + ui.logsOutput.clientHeight >= ui.logsOutput.scrollHeight - 20
          : true;

        const line = document.createElement('div');
        line.className = 'log-line level-' + (entry.level || 'info');
        line.textContent = '[' + formatDate(entry.timestamp) + '] [' + String(entry.level || 'info').toUpperCase() + '] ' + String(entry.message || '');
        ui.logsOutput.appendChild(line);

        while (ui.logsOutput.children.length > 1800) {
          ui.logsOutput.removeChild(ui.logsOutput.firstChild);
        }

        if (shouldStickToBottom) {
          ui.logsOutput.scrollTop = ui.logsOutput.scrollHeight;
        }
      }

      function renderLogs(entries) {
        if (!ui.logsOutput) return;
        ui.logsOutput.innerHTML = '';
        (entries || []).forEach((entry) => appendLogEntry(entry, false));
        setText(ui.logsMeta, (entries || []).length + ' log entries loaded.');
      }

      async function loadLogs() {
        const params = new URLSearchParams();
        params.set('limit', '500');

        const selectedLevel = ui.logLevel && ui.logLevel.value ? ui.logLevel.value : 'all';
        if (selectedLevel !== 'all') {
          params.set('level', selectedLevel);
        }

        const query = ui.logQuery && ui.logQuery.value ? ui.logQuery.value.trim() : '';
        if (query) {
          params.set('q', query);
        }

        const payload = await api('/api/logs?' + params.toString());
        renderLogs(Array.isArray(payload.logs) ? payload.logs : []);
      }

      function stopLogStream() {
        if (state.logEventSource) {
          state.logEventSource.close();
          state.logEventSource = null;
        }
        if (ui.toggleLogStreamBtn) {
          ui.toggleLogStreamBtn.textContent = 'Start Live Logs';
        }
      }

      function startLogStream() {
        stopLogStream();

        const params = new URLSearchParams();
        params.set('historyLimit', '120');

        const selectedLevel = ui.logLevel && ui.logLevel.value ? ui.logLevel.value : 'all';
        if (selectedLevel !== 'all') {
          params.set('level', selectedLevel);
        }

        const query = ui.logQuery && ui.logQuery.value ? ui.logQuery.value.trim() : '';
        if (query) {
          params.set('q', query);
        }

        const source = new EventSource('/api/logs/stream?' + params.toString());
        state.logEventSource = source;

        if (ui.toggleLogStreamBtn) {
          ui.toggleLogStreamBtn.textContent = 'Stop Live Logs';
        }

        source.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data || '{}');
            if (payload.type === 'history') {
              renderLogs(Array.isArray(payload.entries) ? payload.entries : []);
              return;
            }
            if (payload.type === 'log' && payload.entry) {
              appendLogEntry(payload.entry, true);
              const count = ui.logsOutput ? ui.logsOutput.children.length : 0;
              setText(ui.logsMeta, count + ' log entries visible.');
            }
          } catch (_) {
            // Ignore malformed messages
          }
        };

        source.onerror = () => {
          stopLogStream();
          showNotice('Live log stream disconnected.', 'error');
        };
      }

      async function clearLogBuffer() {
        const confirmed = window.confirm('Clear in-memory log buffer?');
        if (!confirmed) return;

        await api('/api/logs/clear', { method: 'POST' });
        if (ui.logsOutput) ui.logsOutput.innerHTML = '';
        setText(ui.logsMeta, 'Log buffer cleared.');
        showNotice('Log buffer cleared.', 'success');
      }

      function bindEvents() {
        if (ui.refreshAllBtn) {
          ui.refreshAllBtn.addEventListener('click', async () => {
            try {
              await refreshAll();
              showNotice('All sections refreshed.', 'success');
            } catch (error) {
              showNotice(error.message, 'error');
            }
          });
        }

        if (ui.refreshStatusBtn) {
          ui.refreshStatusBtn.addEventListener('click', async () => {
            try {
              await loadStatus();
            } catch (error) {
              showNotice(error.message, 'error');
            }
          });
        }

        if (ui.refreshQrBtn) {
          ui.refreshQrBtn.addEventListener('click', async () => {
            try {
              await loadQrImage();
              await loadStatus();
            } catch (error) {
              showNotice(error.message, 'error');
            }
          });
        }

        if (ui.refreshOpsBtn) {
          ui.refreshOpsBtn.addEventListener('click', async () => {
            try {
              await loadOpsSummary();
            } catch (error) {
              showNotice(error.message, 'error');
            }
          });
        }

        if (ui.toggleQrStreamBtn) {
          ui.toggleQrStreamBtn.addEventListener('click', () => {
            if (state.qrEventSource) {
              stopQrStream();
              return;
            }
            startQrStream();
          });
        }

        if (ui.messageForm) {
          ui.messageForm.addEventListener('submit', async (event) => {
            try {
              await submitMessage(event);
            } catch (error) {
              setText(ui.messageFeedback, error.message);
              showNotice(error.message, 'error');
            }
          });
        }

        if (ui.refreshUsageBtn) {
          ui.refreshUsageBtn.addEventListener('click', async () => {
            try {
              await loadCommandUsage();
            } catch (error) {
              showNotice(error.message, 'error');
            }
          });
        }

        if (ui.usageSearch) {
          ui.usageSearch.addEventListener('input', renderUsage);
        }

        if (ui.refreshLeaderboardBtn) {
          ui.refreshLeaderboardBtn.addEventListener('click', async () => {
            try {
              await loadLeaderboard();
            } catch (error) {
              showNotice(error.message, 'error');
            }
          });
        }

        if (ui.configForm) {
          ui.configForm.addEventListener('submit', async (event) => {
            try {
              await saveConfig(event);
            } catch (error) {
              setText(ui.configFeedback, error.message);
              showNotice(error.message, 'error');
            }
          });
        }

        if (ui.resetConfigBtn) {
          ui.resetConfigBtn.addEventListener('click', async () => {
            try {
              await resetConfig();
            } catch (error) {
              showNotice(error.message, 'error');
            }
          });
        }

        if (ui.roleForm) {
          ui.roleForm.addEventListener('submit', async (event) => {
            try {
              await submitRoleChange(event);
            } catch (error) {
              setText(ui.roleFeedback, error.message);
              showNotice(error.message, 'error');
            }
          });
        }

        if (ui.refreshLogsBtn) {
          ui.refreshLogsBtn.addEventListener('click', async () => {
            try {
              await loadLogs();
            } catch (error) {
              showNotice(error.message, 'error');
            }
          });
        }

        if (ui.logLevel) {
          ui.logLevel.addEventListener('change', async () => {
            if (state.logEventSource) {
              startLogStream();
              return;
            }
            await loadLogs();
          });
        }

        if (ui.logQuery) {
          ui.logQuery.addEventListener('keydown', async (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (state.logEventSource) {
              startLogStream();
              return;
            }
            await loadLogs();
          });
        }

        if (ui.toggleLogStreamBtn) {
          ui.toggleLogStreamBtn.addEventListener('click', () => {
            if (state.logEventSource) {
              stopLogStream();
              return;
            }
            startLogStream();
          });
        }

        if (ui.clearLogViewBtn) {
          ui.clearLogViewBtn.addEventListener('click', () => {
            if (ui.logsOutput) ui.logsOutput.innerHTML = '';
            setText(ui.logsMeta, 'Log view cleared.');
          });
        }

        if (ui.clearLogBufferBtn) {
          ui.clearLogBufferBtn.addEventListener('click', async () => {
            try {
              await clearLogBuffer();
            } catch (error) {
              showNotice(error.message, 'error');
            }
          });
        }

        window.addEventListener('beforeunload', () => {
          stopQrStream();
          stopLogStream();
          clearQrObjectUrl();
          if (state.autoRefreshTimer) {
            window.clearInterval(state.autoRefreshTimer);
            state.autoRefreshTimer = null;
          }
        });
      }

      async function refreshAll() {
        await Promise.all([
          loadStatus(),
          loadQrImage(),
          loadOpsSummary(),
          loadCommandUsage(),
          loadLeaderboard(),
          loadConfig(),
          loadLogs(),
        ]);
      }

      async function bootstrap() {
        bindEvents();

        try {
          await refreshAll();
          startQrStream();
        } catch (error) {
          showNotice(error.message, 'error');
        }

        state.autoRefreshTimer = window.setInterval(() => {
          loadStatus().catch(() => {
            // Ignore polling failures and keep loop alive
          });
          loadOpsSummary().catch(() => {
            // Ignore polling failures and keep loop alive
          });
        }, 20000);
      }

      bootstrap();
    })();`;
