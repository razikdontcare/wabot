export const ADMIN_CONSOLE_COMMANDS_BODY = `      <section id="commands" class="panel">
        <div class="panel-head">
          <h2>Commands</h2>
          <p>Create data-only commands, tune built-in ones, and disable anything the bot should not answer. Saved changes apply to the running bot immediately.</p>
        </div>
        <div class="commands-toolbar">
          <div class="field commands-toolbar-search">
            <label for="commandSearch">Search commands</label>
            <input id="commandSearch" placeholder="Filter by name, alias, or description" />
          </div>
          <div class="field">
            <label for="commandSourceFilter">Source</label>
            <select id="commandSourceFilter">
              <option value="all">all</option>
              <option value="builtin">built-in</option>
              <option value="custom">custom</option>
            </select>
          </div>
          <div class="field">
            <label for="commandStatusFilter">Status</label>
            <select id="commandStatusFilter">
              <option value="all">all</option>
              <option value="enabled">enabled</option>
              <option value="disabled">disabled</option>
            </select>
          </div>
          <div class="commands-toolbar-actions">
            <button id="refreshCommandsBtn" type="button">Refresh Commands</button>
            <button id="newCommandBtn" class="primary" type="button">New Command</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Command</th>
                <th>Source</th>
                <th>Status</th>
                <th>Description</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="commandsTableBody"></tbody>
          </table>
        </div>
        <p class="meta" id="commandsMeta">Load the list to see built-in and custom commands together.</p>

        <div id="commandFormPanel" class="commands-form-panel" hidden>
          <div class="panel-head">
            <h2 id="commandFormTitle">New command</h2>
            <p>Custom commands are data-only text templates, so the bot never executes code saved from this form.</p>
          </div>
          <form id="commandForm" class="commands-form-grid">
            <div class="field">
              <label for="cmdName">Name</label>
              <input id="cmdName" name="name" placeholder="halo" autocomplete="off" />
            </div>
            <div class="field">
              <label for="cmdAliases">Aliases</label>
              <input id="cmdAliases" name="aliases" placeholder="hi, hey" autocomplete="off" />
            </div>
            <div class="field">
              <label for="cmdDescription">Description</label>
              <input id="cmdDescription" name="description" placeholder="Short summary shown in the help list" />
            </div>
            <div class="field">
              <label for="cmdCategory">Category</label>
              <select id="cmdCategory" name="category">
                <option value="general">general</option>
                <option value="utility">utility</option>
              </select>
            </div>
            <div class="field">
              <label for="cmdCooldown">Cooldown (ms)</label>
              <input id="cmdCooldown" name="cooldown" type="number" min="0" max="86400000" placeholder="0" />
            </div>
            <div class="field">
              <label for="cmdMaxUses">Max uses</label>
              <input id="cmdMaxUses" name="maxUses" type="number" min="1" max="1000" placeholder="1000" />
            </div>
            <div class="field commands-field-wide">
              <label for="cmdResponse">Response template</label>
              <textarea id="cmdResponse" name="response" placeholder="Halo {{args}}!"></textarea>
              <p class="meta commands-cheatsheet">Placeholders: <span class="mono">{{args}}</span>, <span class="mono">{{arg1}}</span> to <span class="mono">{{arg9}}</span>, <span class="mono">{{user}}</span>, <span class="mono">{{chat}}</span>, <span class="mono">{{prefix}}</span>, <span class="mono">{{botname}}</span>, <span class="mono">{{date}}</span>, <span class="mono">{{time}}</span>, <span class="mono">{{command}}</span>. Plain text only, 1-4096 characters.</p>
            </div>
            <div class="field commands-field-wide">
              <label for="cmdHelpText">Help text</label>
              <textarea id="cmdHelpText" name="helpText" placeholder="Optional longer explanation shown by the help command (max 2000 characters)."></textarea>
            </div>
            <div class="field">
              <label for="cmdDisabledReason">Disabled reason</label>
              <input id="cmdDisabledReason" name="disabledReason" placeholder="Shown when the command is disabled" />
            </div>
            <div class="field">
              <label for="cmdRequiredRoles">Required roles</label>
              <input id="cmdRequiredRoles" name="requiredRoles" placeholder="admin, moderator, vip" />
            </div>
            <div class="field inline">
              <input id="cmdEnabled" name="enabled" type="checkbox" checked />
              <label for="cmdEnabled">Enabled</label>
            </div>
            <div class="field inline">
              <input id="cmdVipOnly" name="vipOnly" type="checkbox" />
              <label for="cmdVipOnly">VIP only</label>
            </div>
            <div class="btn-row commands-field-wide">
              <button id="saveCommandBtn" class="primary" type="submit">Save Command</button>
              <button id="cancelCommandBtn" class="ghost" type="button">Cancel</button>
            </div>
          </form>
          <p class="meta" id="cmdFormFeedback">Name, response, and category apply to custom commands; the other fields override built-in behavior.</p>
        </div>
      </section>`;
