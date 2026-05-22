export const ADMIN_CONSOLE_BODY = `<div class="page">
    <header class="topbar">
      <div class="topbar-row">
        <div class="brand">
          <h1>Meow Admin Console</h1>
          <p>Operational control center for bot runtime, configuration, and telemetry.</p>
        </div>
        <div class="status-cluster">
          <span id="connectionBadge" class="chip">Checking status</span>
          <button id="refreshAllBtn" class="primary" type="button">Refresh All</button>
        </div>
      </div>
      <nav class="nav" aria-label="Section Navigation">
        <a href="#overview">Overview</a>
        <a href="#operations">Operations</a>
        <a href="#analytics">Analytics</a>
        <a href="#configuration">Configuration</a>
        <a href="#logs">Logs</a>
      </nav>
      <div id="globalNotice" class="notice" role="status" aria-live="polite"></div>
    </header>

    <main class="sections">
      <section id="overview" class="panel">
        <div class="panel-head">
          <h2>Overview</h2>
          <p>Live status, QR authentication, and outbound message dispatch.</p>
        </div>
        <div class="grid">
          <article class="tile w4">
            <h3>Runtime Status</h3>
            <div class="stat-list">
              <div class="stat">
                <span class="label">Status</span>
                <span class="value" id="statusValue">-</span>
              </div>
              <div class="stat">
                <span class="label">Connected</span>
                <span class="value" id="connectedValue">-</span>
              </div>
              <div class="stat">
                <span class="label">QR Ready</span>
                <span class="value" id="qrValue">-</span>
              </div>
              <div class="stat">
                <span class="label">Bot User</span>
                <span class="value mono" id="userValue">-</span>
              </div>
            </div>
            <div class="btn-row">
              <button id="refreshStatusBtn" class="ghost" type="button">Refresh Status</button>
            </div>
          </article>

          <article class="tile w4">
            <h3>QR Authentication</h3>
            <div class="qr-box">
              <img id="qrImage" alt="QR Code" />
            </div>
            <p class="meta" id="qrState">Waiting for data.</p>
            <div class="btn-row">
              <button id="refreshQrBtn" type="button">Refresh QR</button>
              <button id="toggleQrStreamBtn" class="primary" type="button">Start Live QR</button>
            </div>
          </article>

          <article class="tile w4">
            <h3>Send Message</h3>
            <form id="messageForm">
              <div class="field">
                <label for="messageJid">Target JID</label>
                <input id="messageJid" name="jid" placeholder="628123456789@s.whatsapp.net" required />
              </div>
              <div class="field">
                <label for="messageText">Message</label>
                <textarea id="messageText" name="text" placeholder="Write message content" required></textarea>
              </div>
              <div class="btn-row">
                <button class="primary" type="submit">Send</button>
              </div>
            </form>
            <p class="meta" id="messageFeedback">No message sent yet.</p>
          </article>
        </div>
      </section>

      <section id="operations" class="panel">
        <div class="panel-head">
          <h2>Operations</h2>
          <p>Runtime health, service connectivity, and configuration metadata.</p>
        </div>
        <div class="grid">
          <article class="tile w4">
            <h3>Process</h3>
            <div class="stat-list">
              <div class="stat">
                <span class="label">Uptime</span>
                <span class="value" id="opsUptimeValue">-</span>
              </div>
              <div class="stat">
                <span class="label">PID</span>
                <span class="value mono" id="opsPidValue">-</span>
              </div>
              <div class="stat">
                <span class="label">Memory</span>
                <span class="value" id="opsMemoryValue">-</span>
              </div>
              <div class="stat">
                <span class="label">Node</span>
                <span class="value mono" id="opsNodeValue">-</span>
              </div>
            </div>
          </article>

          <article class="tile w4">
            <h3>Connectivity</h3>
            <div class="stat-list">
              <div class="stat">
                <span class="label">MongoDB</span>
                <span class="value" id="opsMongoValue">-</span>
              </div>
              <div class="stat">
                <span class="label">QR Streams</span>
                <span class="value" id="opsStreamsValue">-</span>
              </div>
              <div class="stat">
                <span class="label">Log Buffer</span>
                <span class="value" id="opsLogBufferValue">-</span>
              </div>
              <div class="stat">
                <span class="label">Bot Status</span>
                <span class="value" id="opsBotStatusValue">-</span>
              </div>
            </div>
          </article>

          <article class="tile w4">
            <h3>Configuration</h3>
            <div class="stat-list">
              <div class="stat">
                <span class="label">Name / Prefix</span>
                <span class="value" id="opsConfigValue">-</span>
              </div>
              <div class="stat">
                <span class="label">Maintenance</span>
                <span class="value" id="opsMaintenanceValue">-</span>
              </div>
              <div class="stat">
                <span class="label">Updated</span>
                <span class="value" id="opsUpdatedValue">-</span>
              </div>
              <div class="stat">
                <span class="label">Updated By</span>
                <span class="value mono" id="opsUpdatedByValue">-</span>
              </div>
            </div>
            <div class="btn-row">
              <button id="refreshOpsBtn" type="button">Refresh Ops</button>
            </div>
          </article>
        </div>
      </section>

      <section id="analytics" class="panel">
        <div class="panel-head">
          <h2>Analytics</h2>
          <p>Command usage and game leaderboard from existing bot data stores.</p>
        </div>
        <div class="grid">
          <article class="tile w8">
            <h3>Command Usage</h3>
            <div class="row">
              <div class="field" style="grid-column: span 8;">
                <label for="usageSearch">Filter</label>
                <input id="usageSearch" placeholder="Search command name" />
              </div>
              <div class="field" style="grid-column: span 4; align-self: end;">
                <button id="refreshUsageBtn" type="button">Reload Usage</button>
              </div>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Command</th>
                    <th>Total Calls</th>
                    <th>Unique Users</th>
                    <th>Last Used</th>
                  </tr>
                </thead>
                <tbody id="usageTableBody"></tbody>
              </table>
            </div>
            <p class="meta" id="usageMeta">No data loaded.</p>
          </article>

          <article class="tile w4">
            <h3>Leaderboard</h3>
            <div class="row">
              <div class="field" style="grid-column: span 7;">
                <label for="leaderboardGame">Game</label>
                <select id="leaderboardGame">
                  <option value="hangman">hangman</option>
                  <option value="rps">rps</option>
                </select>
              </div>
              <div class="field" style="grid-column: span 5;">
                <label for="leaderboardLimit">Rows</label>
                <input id="leaderboardLimit" type="number" min="1" max="50" value="10" />
              </div>
            </div>
            <div class="btn-row">
              <button id="refreshLeaderboardBtn" type="button">Load Leaderboard</button>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Score</th>
                    <th>W/L/D</th>
                    <th>Last Played</th>
                  </tr>
                </thead>
                <tbody id="leaderboardBody"></tbody>
              </table>
            </div>
            <p class="meta" id="leaderboardMeta">No leaderboard loaded.</p>
          </article>
        </div>
      </section>

      <section id="configuration" class="panel">
        <div class="panel-head">
          <h2>Configuration</h2>
          <p>Edit runtime configuration and role assignments without redeploy.</p>
        </div>
        <div class="grid">
          <article class="tile w8">
            <h3>Bot Configuration</h3>
            <form id="configForm">
              <div class="row">
                <div class="field" style="grid-column: span 6;">
                  <label for="cfgName">Bot Name</label>
                  <input id="cfgName" />
                </div>
                <div class="field" style="grid-column: span 3;">
                  <label for="cfgPrefix">Primary Prefix</label>
                  <input id="cfgPrefix" />
                </div>
                <div class="field" style="grid-column: span 3;">
                  <label for="cfgAltPrefixes">Alternative Prefixes</label>
                  <input id="cfgAltPrefixes" placeholder="/, ." />
                </div>
              </div>

              <div class="row">
                <div class="field" style="grid-column: span 4;">
                  <label for="cfgMaxSessions">Max Sessions</label>
                  <input id="cfgMaxSessions" type="number" min="1" />
                </div>
                <div class="field" style="grid-column: span 4;">
                  <label for="cfgSessionTimeout">Session Timeout (ms)</label>
                  <input id="cfgSessionTimeout" type="number" min="1000" />
                </div>
              </div>

              <div class="row">
                <div class="field inline" style="grid-column: span 4;">
                  <input id="cfgAllowFromMe" type="checkbox" />
                  <label for="cfgAllowFromMe">Allow From Me</label>
                </div>
                <div class="field inline" style="grid-column: span 4;">
                  <input id="cfgAllowMentionPrefix" type="checkbox" />
                  <label for="cfgAllowMentionPrefix">Allow Mention Prefix</label>
                </div>
                <div class="field inline" style="grid-column: span 4;">
                  <input id="cfgDisableWarning" type="checkbox" />
                  <label for="cfgDisableWarning">Disable Warning</label>
                </div>
              </div>

              <div class="row">
                <div class="field inline" style="grid-column: span 6;">
                  <input id="cfgMaintenanceMode" type="checkbox" />
                  <label for="cfgMaintenanceMode">Maintenance Mode</label>
                </div>
              </div>

              <div class="btn-row">
                <button id="saveConfigBtn" class="primary" type="submit">Save Configuration</button>
                <button id="resetConfigBtn" class="ghost" type="button">Reset to Defaults</button>
              </div>
            </form>
            <p class="meta" id="configFeedback">No changes submitted.</p>
          </article>

          <article class="tile w4">
            <h3>Role Management</h3>
            <form id="roleForm">
              <div class="field">
                <label for="roleAction">Action</label>
                <select id="roleAction">
                  <option value="add">Add</option>
                  <option value="remove">Remove</option>
                </select>
              </div>
              <div class="field">
                <label for="roleType">Role</label>
                <select id="roleType">
                  <option value="admin">admin</option>
                  <option value="moderator">moderator</option>
                  <option value="vip">vip</option>
                </select>
              </div>
              <div class="field">
                <label for="roleUserJid">User JID</label>
                <input id="roleUserJid" placeholder="628123456789@s.whatsapp.net" required />
              </div>
              <div class="btn-row">
                <button class="primary" type="submit">Apply Role Change</button>
              </div>
            </form>
            <p class="meta" id="roleFeedback">No role updates yet.</p>
          </article>
        </div>
      </section>

      <section id="logs" class="panel">
        <div class="panel-head">
          <h2>Logs</h2>
          <p>Live and historical bot logs from the in-memory log buffer.</p>
        </div>
        <div class="grid">
          <article class="tile w12" style="grid-column: 1 / -1;">
            <div class="row">
              <div class="field" style="grid-column: span 3;">
                <label for="logLevel">Level</label>
                <select id="logLevel">
                  <option value="all">all</option>
                  <option value="error">error</option>
                  <option value="warn">warn</option>
                  <option value="info">info</option>
                  <option value="debug">debug</option>
                  <option value="verbose">verbose</option>
                </select>
              </div>
              <div class="field" style="grid-column: span 5;">
                <label for="logQuery">Search</label>
                <input id="logQuery" placeholder="Filter log message" />
              </div>
              <div class="field" style="grid-column: span 4; align-self: end;">
                <div class="btn-row">
                  <button id="refreshLogsBtn" type="button">Refresh Logs</button>
                  <button id="toggleLogStreamBtn" class="primary" type="button">Start Live Logs</button>
                </div>
              </div>
            </div>
            <div class="btn-row">
              <button id="clearLogViewBtn" class="ghost" type="button">Clear View</button>
              <button id="clearLogBufferBtn" class="ghost" type="button">Clear Buffer</button>
            </div>
            <div id="logsOutput" class="log-shell" role="log" aria-live="polite"></div>
            <p class="meta" id="logsMeta">No logs loaded.</p>
          </article>
        </div>
      </section>
    </main>
  </div>`;
