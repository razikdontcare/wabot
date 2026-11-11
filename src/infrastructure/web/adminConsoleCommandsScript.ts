export const ADMIN_CONSOLE_COMMANDS_SCRIPT = `(() => {
      const state = {
        commands: [],
        editing: null,
      };

      const ui = {
        commandsTableBody: document.getElementById('commandsTableBody'),
        commandSearch: document.getElementById('commandSearch'),
        commandSourceFilter: document.getElementById('commandSourceFilter'),
        commandStatusFilter: document.getElementById('commandStatusFilter'),
        newCommandBtn: document.getElementById('newCommandBtn'),
        refreshCommandsBtn: document.getElementById('refreshCommandsBtn'),
        commandsMeta: document.getElementById('commandsMeta'),
        commandFormPanel: document.getElementById('commandFormPanel'),
        commandForm: document.getElementById('commandForm'),
        commandFormTitle: document.getElementById('commandFormTitle'),
        cmdName: document.getElementById('cmdName'),
        cmdAliases: document.getElementById('cmdAliases'),
        cmdDescription: document.getElementById('cmdDescription'),
        cmdCategory: document.getElementById('cmdCategory'),
        cmdResponse: document.getElementById('cmdResponse'),
        cmdCooldown: document.getElementById('cmdCooldown'),
        cmdMaxUses: document.getElementById('cmdMaxUses'),
        cmdVipOnly: document.getElementById('cmdVipOnly'),
        cmdRequiredRoles: document.getElementById('cmdRequiredRoles'),
        cmdEnabled: document.getElementById('cmdEnabled'),
        cmdDisabledReason: document.getElementById('cmdDisabledReason'),
        cmdHelpText: document.getElementById('cmdHelpText'),
        cmdFormFeedback: document.getElementById('cmdFormFeedback'),
        cancelCommandBtn: document.getElementById('cancelCommandBtn'),
        saveCommandBtn: document.getElementById('saveCommandBtn'),
      };

      const COMMAND_ROLES = ['admin', 'moderator', 'vip'];

      function setText(node, value) {
        if (node) node.textContent = String(value);
      }

      function createElement(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = String(text);
        return node;
      }

      function createButton(label, action, name, className) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className || '';
        button.setAttribute('data-action', action);
        button.setAttribute('data-name', name);
        button.textContent = label;
        return button;
      }

      function formatDate(value) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString();
      }

      function extractError(payload, fallback) {
        if (payload && typeof payload === 'object') {
          const parts = [];
          if (payload.error) parts.push(String(payload.error));
          if (Array.isArray(payload.details)) {
            payload.details.forEach((detail) => {
              if (detail && detail.field && detail.message) {
                parts.push(String(detail.field) + ': ' + String(detail.message));
              }
            });
          }
          if (parts.length) return parts.join(' - ');
        }
        return fallback;
      }

      async function api(path, options) {
        const opts = Object.assign({}, options || {});
        const headers = Object.assign({}, opts.headers || {});

        if (opts.body !== undefined && typeof opts.body !== 'string') {
          headers['Content-Type'] = 'application/json';
          opts.body = JSON.stringify(opts.body);
        }

        opts.headers = headers;

        const response = await fetch(path, opts);
        const contentType = response.headers.get('content-type') || '';
        const isJson = contentType.indexOf('application/json') !== -1;

        if (!response.ok) {
          const payload = isJson
            ? await response.json().catch(() => null)
            : await response.text().catch(() => '');
          throw new Error(extractError(payload, 'Request failed (' + response.status + ')'));
        }

        if (!isJson) return null;
        return response.json().catch(() => null);
      }

      function setMeta(message, isError) {
        if (!ui.commandsMeta) return;
        ui.commandsMeta.textContent = message;
        ui.commandsMeta.className = isError ? 'meta text-danger' : 'meta';
      }

      function setFormFeedback(message, isError) {
        if (!ui.cmdFormFeedback) return;
        ui.cmdFormFeedback.textContent = message;
        ui.cmdFormFeedback.className = isError ? 'meta text-danger' : 'meta';
      }

      function matchesFilters(command) {
        const query = ui.commandSearch ? ui.commandSearch.value.trim().toLowerCase() : '';
        const source = ui.commandSourceFilter ? ui.commandSourceFilter.value : 'all';
        const status = ui.commandStatusFilter ? ui.commandStatusFilter.value : 'all';

        if (source && source !== 'all' && command.source !== source) return false;
        if (status === 'enabled' && !command.enabled) return false;
        if (status === 'disabled' && command.enabled) return false;
        if (!query) return true;

        const aliases = Array.isArray(command.aliases) ? command.aliases : [];
        const haystack = [command.name, command.description].concat(aliases).join(' ').toLowerCase();
        return haystack.indexOf(query) !== -1;
      }

      function renderCommandRow(command) {
        const row = document.createElement('tr');

        const nameCell = document.createElement('td');
        nameCell.appendChild(createElement('span', 'mono', command.name));
        const aliases = Array.isArray(command.aliases) ? command.aliases : [];
        if (aliases.length) {
          nameCell.appendChild(createElement('div', 'meta', 'Aliases: ' + aliases.join(', ')));
        }
        row.appendChild(nameCell);

        const sourceCell = document.createElement('td');
        const sourceLabel = command.source === 'custom' ? 'custom' : 'built-in';
        sourceCell.appendChild(
          createElement('span', 'commands-badge commands-source-' + command.source, sourceLabel),
        );
        row.appendChild(sourceCell);

        const statusCell = document.createElement('td');
        const toggle = createButton(
          command.enabled ? 'enabled' : 'disabled',
          'toggle',
          command.name,
          'commands-badge commands-status-' + (command.enabled ? 'enabled' : 'disabled'),
        );
        toggle.title = command.enabled ? 'Disable this command' : 'Enable this command';
        toggle.setAttribute('aria-pressed', command.enabled ? 'true' : 'false');
        statusCell.appendChild(toggle);
        if (!command.enabled && command.disabledReason) {
          statusCell.appendChild(createElement('div', 'meta', command.disabledReason));
        }
        row.appendChild(statusCell);

        const descriptionCell = document.createElement('td');
        descriptionCell.appendChild(createElement('div', '', command.description));
        const details = [command.category || 'general'];
        if (typeof command.cooldown === 'number') details.push('cooldown ' + command.cooldown + ' ms');
        if (typeof command.maxUses === 'number') details.push('max ' + command.maxUses + ' uses');
        if (command.vipOnly) details.push('VIP only');
        if (Array.isArray(command.requiredRoles) && command.requiredRoles.length) {
          details.push('roles: ' + command.requiredRoles.join(', '));
        }
        descriptionCell.appendChild(createElement('div', 'meta', details.join(' · ')));
        row.appendChild(descriptionCell);

        const updatedCell = document.createElement('td');
        if (command.source === 'custom' && command.updatedAt) {
          updatedCell.appendChild(createElement('div', 'meta', formatDate(command.updatedAt)));
          if (command.updatedBy) {
            updatedCell.appendChild(createElement('div', 'meta', 'by ' + command.updatedBy));
          }
        } else {
          updatedCell.appendChild(createElement('div', 'meta', 'code default'));
        }
        row.appendChild(updatedCell);

        const actionsCell = document.createElement('td');
        const actions = document.createElement('div');
        actions.className = 'commands-actions';
        actions.appendChild(createButton('Edit', 'edit', command.name, 'ghost'));

        if (command.source === 'builtin') {
          const resetButton = createButton('Reset', 'reset', command.name, 'ghost');
          resetButton.title = 'Reset to code defaults';
          actions.appendChild(resetButton);
        } else {
          actions.appendChild(createButton('Delete', 'delete', command.name, 'ghost commands-danger'));
        }

        actionsCell.appendChild(actions);
        row.appendChild(actionsCell);
        return row;
      }

      function updateMeta(visibleCount) {
        const total = state.commands.length;
        if (!total) {
          setMeta('No commands loaded yet. Use Refresh Commands to try again.');
          return;
        }

        const builtinCount = state.commands.filter((command) => command.source === 'builtin').length;
        const customCount = total - builtinCount;
        setMeta(
          visibleCount + ' of ' + total + ' commands · ' + builtinCount + ' built-in · ' + customCount + ' custom',
        );
      }

      function renderTable() {
        const tbody = ui.commandsTableBody;
        if (!tbody) return;

        while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

        const visible = state.commands.filter(matchesFilters);
        if (!visible.length) {
          const row = document.createElement('tr');
          const cell = createElement(
            'td',
            'commands-empty',
            state.commands.length ? 'No commands match the current filters.' : 'No commands loaded yet.',
          );
          cell.colSpan = 6;
          row.appendChild(cell);
          tbody.appendChild(row);
        } else {
          visible.forEach((command) => tbody.appendChild(renderCommandRow(command)));
        }

        updateMeta(visible.length);
      }

      async function loadCommands() {
        if (!ui.commandsTableBody) return;

        try {
          const payload = await api('/api/commands');
          state.commands = payload && Array.isArray(payload.commands) ? payload.commands : [];
          renderTable();
        } catch (error) {
          state.commands = [];
          renderTable();
          setMeta('Could not load commands: ' + error.message, true);
        }
      }

      function setFieldVisible(fieldInput, visible) {
        if (!fieldInput) return;
        const field = fieldInput.closest('.field');
        if (field) field.style.display = visible ? '' : 'none';
      }

      function applyFormMode(command) {
        const editing = Boolean(command);
        const isBuiltin = editing && command.source === 'builtin';

        if (ui.cmdName) ui.cmdName.disabled = editing;
        setFieldVisible(ui.cmdResponse, !isBuiltin);
        setFieldVisible(ui.cmdCategory, !isBuiltin);
        setFieldVisible(ui.cmdDisabledReason, isBuiltin);

        if (ui.saveCommandBtn) {
          ui.saveCommandBtn.textContent = !editing
            ? 'Create Command'
            : isBuiltin
              ? 'Save Override'
              : 'Save Changes';
        }
      }

      function scrollToForm() {
        if (ui.commandFormPanel && ui.commandFormPanel.scrollIntoView) {
          ui.commandFormPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }

      function openCreate() {
        state.editing = null;
        if (!ui.commandFormPanel) return;
        if (ui.commandForm) ui.commandForm.reset();
        if (ui.commandFormTitle) ui.commandFormTitle.textContent = 'New command';
        applyFormMode(null);
        setFormFeedback('Custom commands are plain text templates and take effect immediately.', false);
        ui.commandFormPanel.hidden = false;
        scrollToForm();
      }

      function setInputValue(input, value) {
        if (input) input.value = value;
      }

      function setChecked(input, checked) {
        if (input) input.checked = Boolean(checked);
      }

      function openEdit(name) {
        const command = state.commands.find((entry) => entry.name === name);
        if (!command) return;

        state.editing = command;
        if (ui.commandForm) ui.commandForm.reset();
        if (ui.commandFormPanel) ui.commandFormPanel.hidden = false;
        if (ui.commandFormTitle) ui.commandFormTitle.textContent = 'Edit ' + command.name;

        setInputValue(ui.cmdName, command.name);
        setInputValue(ui.cmdAliases, (Array.isArray(command.aliases) ? command.aliases : []).join(', '));
        setInputValue(ui.cmdDescription, command.description || '');
        setInputValue(ui.cmdHelpText, command.helpText || '');
        setInputValue(ui.cmdCategory, command.category || 'general');
        setInputValue(ui.cmdResponse, command.response || '');
        setInputValue(ui.cmdCooldown, typeof command.cooldown === 'number' ? String(command.cooldown) : '');
        setInputValue(ui.cmdMaxUses, typeof command.maxUses === 'number' ? String(command.maxUses) : '');
        setInputValue(
          ui.cmdRequiredRoles,
          (Array.isArray(command.requiredRoles) ? command.requiredRoles : []).join(', '),
        );
        setInputValue(ui.cmdDisabledReason, command.disabledReason || '');
        setChecked(ui.cmdVipOnly, command.vipOnly);
        setChecked(ui.cmdEnabled, command.enabled);

        applyFormMode(command);
        setFormFeedback(
          command.source === 'builtin'
            ? 'Editing a built-in command. Saved changes override the code defaults; use Reset to restore them.'
            : 'Editing a custom command. Changes apply to the running bot immediately.',
          false,
        );
        scrollToForm();
      }

      function closeForm() {
        state.editing = null;
        if (ui.commandFormPanel) ui.commandFormPanel.hidden = true;
        if (ui.commandForm) ui.commandForm.reset();
        if (ui.saveCommandBtn) ui.saveCommandBtn.disabled = false;
      }

      function splitList(text) {
        return String(text || '')
          .split(',')
          .map((entry) => entry.trim().toLowerCase())
          .filter((entry) => entry.length > 0);
      }

      function readNumber(input) {
        if (!input) return undefined;
        const raw = input.value.trim();
        if (!raw) return undefined;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : undefined;
      }

      function buildPayload() {
        const payload = {
          aliases: splitList(ui.cmdAliases ? ui.cmdAliases.value : ''),
          description: ui.cmdDescription ? ui.cmdDescription.value.trim() : '',
          enabled: ui.cmdEnabled ? ui.cmdEnabled.checked : true,
          vipOnly: ui.cmdVipOnly ? ui.cmdVipOnly.checked : false,
          requiredRoles: splitList(ui.cmdRequiredRoles ? ui.cmdRequiredRoles.value : '').filter(
            (role) => COMMAND_ROLES.indexOf(role) !== -1,
          ),
        };

        const cooldown = readNumber(ui.cmdCooldown);
        if (cooldown !== undefined) payload.cooldown = cooldown;

        const maxUses = readNumber(ui.cmdMaxUses);
        if (maxUses !== undefined) payload.maxUses = maxUses;

        const helpText = ui.cmdHelpText ? ui.cmdHelpText.value.trim() : '';
        if (helpText) payload.helpText = helpText;
        else if (state.editing) payload.helpText = '';

        const isBuiltin = state.editing && state.editing.source === 'builtin';
        if (isBuiltin) {
          payload.disabledReason = ui.cmdDisabledReason ? ui.cmdDisabledReason.value.trim() : '';
        } else {
          payload.category = ui.cmdCategory ? ui.cmdCategory.value : 'general';
          payload.response = ui.cmdResponse ? ui.cmdResponse.value : '';
        }

        if (!state.editing) {
          payload.name = ui.cmdName ? ui.cmdName.value.trim().toLowerCase() : '';
        }

        return payload;
      }

      async function submitForm(event) {
        if (event) event.preventDefault();

        const payload = buildPayload();
        const editingName = state.editing ? state.editing.name : '';

        if (ui.saveCommandBtn) ui.saveCommandBtn.disabled = true;
        setFormFeedback('Saving...', false);

        try {
          if (state.editing) {
            await api('/api/commands/' + encodeURIComponent(editingName), {
              method: 'PATCH',
              body: payload,
            });
          } else {
            await api('/api/commands', { method: 'POST', body: payload });
          }

          const savedName = editingName || payload.name;
          closeForm();
          await loadCommands();
          setMeta('Saved command "' + savedName + '".', false);
        } catch (error) {
          setFormFeedback(error.message, true);
        } finally {
          if (ui.saveCommandBtn) ui.saveCommandBtn.disabled = false;
        }
      }

      async function toggleEnabled(name) {
        const command = state.commands.find((entry) => entry.name === name);
        if (!command) return;

        const enabled = !command.enabled;
        try {
          await api('/api/commands/' + encodeURIComponent(name), {
            method: 'PATCH',
            body: { enabled: enabled },
          });
          await loadCommands();
          setMeta('Command "' + name + '" is now ' + (enabled ? 'enabled' : 'disabled') + '.', false);
        } catch (error) {
          setMeta('Could not update "' + name + '": ' + error.message, true);
        }
      }

      async function deleteCommand(name) {
        const command = state.commands.find((entry) => entry.name === name);
        if (!command) return;

        if (command.source !== 'custom') {
          setMeta('Only custom commands can be deleted. Use Reset for built-ins.', true);
          return;
        }

        if (!window.confirm('Delete custom command "' + name + '"? This cannot be undone.')) return;

        try {
          await api('/api/commands/' + encodeURIComponent(name), { method: 'DELETE' });
          await loadCommands();
          setMeta('Deleted command "' + name + '".', false);
        } catch (error) {
          setMeta('Could not delete "' + name + '": ' + error.message, true);
        }
      }

      async function resetCommand(name) {
        const command = state.commands.find((entry) => entry.name === name);
        if (!command) return;

        if (command.source !== 'builtin') {
          setMeta('Only built-in commands can be reset.', true);
          return;
        }

        if (!window.confirm('Reset built-in command "' + name + '" to its code defaults?')) return;

        try {
          await api('/api/commands/' + encodeURIComponent(name) + '/reset', { method: 'POST' });
          await loadCommands();
          setMeta('Reset command "' + name + '" to code defaults.', false);
        } catch (error) {
          setMeta('Could not reset "' + name + '": ' + error.message, true);
        }
      }

      function bindEvents() {
        if (ui.refreshCommandsBtn) {
          ui.refreshCommandsBtn.addEventListener('click', () => {
            setMeta('Loading commands...', false);
            loadCommands();
          });
        }

        if (ui.newCommandBtn) ui.newCommandBtn.addEventListener('click', openCreate);
        if (ui.cancelCommandBtn) ui.cancelCommandBtn.addEventListener('click', closeForm);
        if (ui.commandForm) ui.commandForm.addEventListener('submit', submitForm);

        if (ui.commandsTableBody) {
          ui.commandsTableBody.addEventListener('click', (event) => {
            const target = event.target;
            if (!target || typeof target.closest !== 'function') return;

            const button = target.closest('button[data-action]');
            if (!button) return;

            const name = button.getAttribute('data-name') || '';
            const action = button.getAttribute('data-action');

            if (action === 'edit') openEdit(name);
            else if (action === 'toggle') toggleEnabled(name);
            else if (action === 'delete') deleteCommand(name);
            else if (action === 'reset') resetCommand(name);
          });
        }

        if (ui.commandSearch) ui.commandSearch.addEventListener('input', renderTable);
        if (ui.commandSourceFilter) ui.commandSourceFilter.addEventListener('change', renderTable);
        if (ui.commandStatusFilter) ui.commandStatusFilter.addEventListener('change', renderTable);

        window.addEventListener('admin:refresh', () => {
          loadCommands();
        });
      }

      function bootstrap() {
        if (!document.getElementById('commands') || !ui.commandsTableBody) return;
        bindEvents();
        loadCommands();
      }

      bootstrap();
    })();`;
