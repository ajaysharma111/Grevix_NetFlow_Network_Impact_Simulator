/* NetFlow — client-side network change impact simulator.
   Reachability is computed with BFS over operational nodes and links. */
(() => {
  const $ = (id) => document.getElementById(id);
  if (typeof cytoscape === "undefined") {
    $("canvasHint").innerHTML = '<b>Could not load the graph library</b><small>Connect to the internet and refresh. Cytoscape.js is loaded from a CDN.</small>';
    return;
  }

  const cy = cytoscape({
    container: $("cy"), elements: [], minZoom: 0.45, maxZoom: 2.2,
    wheelSensitivity: 0.22,
    style: [
      { selector: "node", style: {
        "label": "data(label)", "text-wrap": "wrap", "text-max-width": 100,
        "text-valign": "bottom", "text-margin-y": 9, "font-family": "Manrope, sans-serif",
        "font-size": 10, "font-weight": 700, "color": "#dce8f8",
        "background-color": "#377ec3", "width": 42, "height": 42,
        "border-width": 2, "border-color": "#79b7ff", "overlay-opacity": 0
      }},
      { selector: 'node[type = "router"]', style: { "shape": "round-rectangle", "background-color": "#194879", "border-color": "#65a9ff", "label": "data(label)" }},
      { selector: 'node[type = "switch"]', style: { "shape": "diamond", "background-color": "#382f6c", "border-color": "#b0a1ff" }},
      { selector: 'node[type = "server"]', style: { "shape": "rectangle", "background-color": "#155447", "border-color": "#62dfb8" }},
      { selector: 'node[status = "down"]', style: { "background-color": "#6d2b3b", "border-color": "#ff687a", "border-style": "dashed", "opacity": 0.9 }},
      { selector: 'node[unreachable = "true"]', style: { "background-color": "#735024", "border-color": "#ffbd65" }},
      { selector: "node:selected", style: { "border-width": 4, "border-color": "#ffffff", "overlay-opacity": 0.12, "overlay-color": "#8bbfff" }},
      { selector: "edge", style: { "width": 3, "line-color": "#4b6687", "curve-style": "bezier", "target-arrow-shape": "none", "overlay-opacity": 0 }},
      { selector: 'edge[status = "down"]', style: { "line-color": "#ff687a", "line-style": "dashed", "width": 3 }},
      { selector: "edge:selected", style: { "line-color": "#ffffff", "width": 4 }}
    ],
    layout: { name: "grid", padding: 40 }
  });

  let counters = { router: 0, switch: 0, server: 0 };
  let linkMode = false, firstLinkNode = null, selectedId = null, lastAnalysis = null, toastTimer;

  const typeNames = { router: "Router", switch: "Switch", server: "Server" };
  const typeSymbols = { router: "R", switch: "S", server: "▣" };
  const makeId = (type) => {
    counters[type] += 1;
    return `${type}${counters[type]}`;
  };
  const notify = (message) => {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  };
  const invalidateAnalysis = () => {
    lastAnalysis = null;
    $("analysisTime").textContent = "Awaiting analysis";
    $("networkStatus").className = "health-indicator";
    $("networkStatus").innerHTML = "<span></span> NOT ANALYZED";
    $("reportContent").innerHTML = '<div class="report-placeholder"><div class="report-placeholder-icon">⌁</div><div><b>Topology changed</b><p>Run impact analysis to calculate the updated reachability results.</p></div></div>';
    cy.nodes().forEach(n => n.data("unreachable", "false"));
    updateStats();
    if (selectedId && cy.getElementById(selectedId).length) renderInspector(cy.getElementById(selectedId));
  };
  const addNode = (type, position) => {
    const id = makeId(type);
    const count = cy.nodes().length;
    const pos = position || { x: 130 + (count % 4) * 95, y: 100 + Math.floor(count / 4) * 90 };
    cy.add({ group: "nodes", data: { id, label: `${typeNames[type]} ${counters[type]}`, type, status: "up", unreachable: "false" }, position: pos });
    $("canvasHint").classList.add("hidden");
    cy.layout({ name: "preset", fit: true, padding: 55, animate: true }).run();
    invalidateAnalysis();
    cy.getElementById(id).select();
    selectedId = id;
    renderInspector(cy.getElementById(id));
    notify(`${typeNames[type]} added`);
  };
  $("addRouter").onclick = () => addNode("router");
  $("addSwitch").onclick = () => addNode("switch");
  $("addServer").onclick = () => addNode("server");

  $("linkMode").onclick = () => {
    linkMode = !linkMode;
    firstLinkNode = null;
    $("linkMode").classList.toggle("active", linkMode);
    $("linkMode").innerHTML = `<span>⌁</span> Link mode: ${linkMode ? "ON" : "OFF"}`;
    $("cy").style.cursor = linkMode ? "crosshair" : "default";
    notify(linkMode ? "Link mode enabled — select two devices" : "Link mode disabled");
  };

  cy.on("tap", "node", (event) => {
    const node = event.target;
    selectedId = node.id();
    if (linkMode) {
      if (!firstLinkNode) {
        firstLinkNode = node;
        renderInspector(node);
        notify(`Selected ${node.data("label")}. Choose a second device.`);
      } else if (firstLinkNode.id() === node.id()) {
        firstLinkNode = null;
        notify("Choose a different device to create a link");
      } else {
        const source = firstLinkNode.id(), target = node.id();
        const existing = cy.edges().filter(e =>
          (e.data("source") === source && e.data("target") === target) ||
          (e.data("source") === target && e.data("target") === source)
        );
        if (existing.length) notify("These devices are already connected");
        else {
          cy.add({ group: "edges", data: { id: `link-${source}-${target}`, source, target, status: "up" } });
          invalidateAnalysis();
          notify(`Connected ${firstLinkNode.data("label")} to ${node.data("label")}`);
        }
        firstLinkNode = null;
        renderInspector(node);
      }
    } else {
      renderInspector(node);
    }
  });
  cy.on("tap", "edge", (event) => {
    if (linkMode) return;
    const edge = event.target;
    edge.data("status", edge.data("status") === "down" ? "up" : "down");
    invalidateAnalysis();
    renderInspector(edge);
    notify(`Link marked ${edge.data("status").toUpperCase()}`);
  });
  cy.on("tap", (event) => {
    if (event.target === cy) {
      selectedId = null;
      renderInspector(null);
    }
  });

  function buildAdjacencyList() {
    const adj = {};
    cy.nodes().forEach(n => { adj[n.id()] = []; });
    cy.edges().forEach(e => {
      const src = e.source(), tgt = e.target();
      if (e.data("status") !== "down" && src.data("status") !== "down" && tgt.data("status") !== "down") {
        adj[src.id()].push(tgt.id());
        adj[tgt.id()].push(src.id());
      }
    });
    return adj;
  }
  function bfs(startId, adjacency) {
    const visited = new Set([startId]), queue = [startId];
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i];
      (adjacency[current] || []).forEach(next => {
        if (!visited.has(next)) { visited.add(next); queue.push(next); }
      });
    }
    return visited;
  }
  function findPath(start, end, adjacency) {
    if (!start || !end) return null;
    const queue = [start], previous = new Map([[start, null]]);
    while (queue.length) {
      const current = queue.shift();
      if (current === end) break;
      (adjacency[current] || []).forEach(next => {
        if (!previous.has(next)) { previous.set(next, current); queue.push(next); }
      });
    }
    if (!previous.has(end)) return null;
    const path = [];
    for (let at = end; at !== null; at = previous.get(at)) path.unshift(at);
    return path;
  }
  function simulateFailure() {
    if (cy.nodes().length === 0) { notify("Add or load devices before analyzing"); return; }
    const adjacency = buildAdjacencyList();
    const servers = cy.nodes('[type = "server"]').filter(s => s.data("status") !== "down");
    const reachable = new Set();
    servers.forEach(server => bfs(server.id(), adjacency).forEach(id => reachable.add(id)));
    const unreachable = [];
    cy.nodes().forEach(n => {
      const isDown = n.data("status") === "down";
      const isUnreachable = !isDown && !reachable.has(n.id());
      n.data("unreachable", isUnreachable ? "true" : "false");
      if (isUnreachable) unreachable.push(n.id());
    });
    const downNodes = cy.nodes().filter(n => n.data("status") === "down").map(n => n.id());
    const downEdges = cy.edges().filter(e => e.data("status") === "down").map(e => e.id());
    const failedServers = cy.nodes('[type = "server"]').filter(s => s.data("status") === "down").map(s => s.id());
    const affectedServers = cy.nodes('[type = "server"]').filter(s => s.data("status") !== "down" && !reachable.has(s.id())).map(s => s.id());
    const allDown = downNodes.length + downEdges.length > 0;
    lastAnalysis = { adjacency, reachable: [...reachable], unreachable, downNodes, downEdges, failedServers, affectedServers, allDown, timestamp: new Date().toLocaleString() };
    renderReport(lastAnalysis);
    $("analysisTime").textContent = `Analyzed ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    const status = $("networkStatus");
    if (!allDown) {
      status.className = "health-indicator ok";
      status.innerHTML = "<span></span> NETWORK HEALTHY";
    } else if (unreachable.length || failedServers.length) {
      status.className = "health-indicator bad";
      status.innerHTML = "<span></span> IMPACT DETECTED";
    } else {
      status.className = "health-indicator ok";
      status.innerHTML = "<span></span> RESILIENT";
    }
    updateStats();
    if (selectedId && cy.getElementById(selectedId).length) renderInspector(cy.getElementById(selectedId));
    notify("Impact analysis completed using BFS");
  }
  $("simulateBtn").onclick = simulateFailure;

  function renderReport(result) {
    const downCount = result.downNodes.length + result.downEdges.length;
    const statusLine = !result.allDown
      ? ["Network healthy", "No devices or links are marked down. Every operational device connected to a server is reachable."]
      : result.unreachable.length || result.failedServers.length
        ? ["Service impact detected", "One or more failures have changed network reachability. Review affected devices and recovery suggestions below."]
        : ["Redundancy preserved", "A failure is present, but all operational devices remain reachable from an operational server."];
    const unreachableLabels = result.unreachable.map(id => cy.getElementById(id).data("label"));
    const failedLabels = result.downNodes.map(id => cy.getElementById(id).data("label"));
    const failedLinkLabels = result.downEdges.map(id => {
      const e = cy.getElementById(id); return `${e.source().data("label")} ↔ ${e.target().data("label")}`;
    });
    let recommendation = "No immediate recovery action required. Save this topology as a baseline for future change tests.";
    if (result.allDown && (result.unreachable.length || result.failedServers.length)) {
      recommendation = "Restore the failed device or link, or add a redundant connection that bridges the disconnected components. Re-run analysis after each change to verify recovery.";
    } else if (result.allDown) {
      recommendation = "The current topology has enough alternate connectivity to preserve reachability. Confirm the redundant path is intended and document it before making production changes.";
    }
    const chips = (items, cls) => items.length ? items.map(x => `<span class="chip ${cls}">${escapeHtml(x)}</span>`).join("") : '<p>None</p>';
    $("reportContent").innerHTML = `
      <div class="report-summary">
        <div class="summary-tile"><span>Operational devices</span><b class="good">${cy.nodes().filter(n=>n.data("status")!=="down").length}</b></div>
        <div class="summary-tile"><span>Unreachable devices</span><b class="${result.unreachable.length ? "warn" : "good"}">${result.unreachable.length}</b></div>
        <div class="summary-tile"><span>Failures detected</span><b class="${downCount ? "warn" : "good"}">${downCount}</b></div>
      </div>
      <div class="report-message ${result.unreachable.length || result.failedServers.length ? "critical" : ""}"><b>${statusLine[0]}</b><p>${statusLine[1]}</p></div>
      <div class="report-columns">
        <div class="report-box"><h3>FAILED DEVICES</h3><div class="chip-list">${chips(failedLabels, "bad")}</div><div style="height:10px"></div><h3>FAILED LINKS</h3><div class="chip-list">${chips(failedLinkLabels, "bad")}</div></div>
        <div class="report-box"><h3>UNREACHABLE DEVICES</h3><div class="chip-list">${chips(unreachableLabels, "warn")}</div><div style="height:10px"></div><h3>IMPACTED SERVERS</h3><div class="chip-list">${chips(result.affectedServers.map(id=>cy.getElementById(id).data("label")), "warn")}</div></div>
      </div>
      <div class="recommendation"><b>↗ Recovery recommendation</b><p>${recommendation}</p></div>`;
  }

  function renderInspector(element) {
    const host = $("inspectorContent");
    if (!element || !element.length) {
      host.innerHTML = '<div class="empty-inspector"><div class="empty-icon">◎</div><b>No device selected</b><p>Select a node in the topology to inspect its status and details.</p></div>';
      return;
    }
    if (element.isEdge && element.isEdge()) {
      const source = element.source(), target = element.target(), down = element.data("status") === "down";
      host.innerHTML = `<div class="device-detail-icon router">⌁</div><div class="device-name">Network link</div><div class="device-type">CONNECTION / EDGE</div><div class="detail-status ${down ? "down" : ""}"><i></i>${down ? "FAILED" : "OPERATIONAL"}</div><div class="detail-list"><div class="detail-row"><span>Endpoint A</span><b>${escapeHtml(source.data("label"))}</b></div><div class="detail-row"><span>Endpoint B</span><b>${escapeHtml(target.data("label"))}</b></div><div class="detail-row"><span>Link ID</span><b>${escapeHtml(element.id())}</b></div></div><div class="inspector-actions"><button class="small-action ${down ? "" : "danger"}" id="toggleSelected">${down ? "Restore link" : "Simulate link failure"}</button><button class="small-action danger" id="deleteSelected">Delete</button></div>`;
      $("toggleSelected").onclick = () => { element.data("status", down ? "up" : "down"); invalidateAnalysis(); renderInspector(element); };
      $("deleteSelected").onclick = () => { element.remove(); selectedId = null; invalidateAnalysis(); renderInspector(null); notify("Link deleted"); };
      return;
    }
    const type = element.data("type"), down = element.data("status") === "down", unreachable = element.data("unreachable") === "true";
    const neighbors = element.neighborhood("node").map(n => n.data("label"));
    const statusText = down ? "FAILED" : unreachable ? "UNREACHABLE" : "OPERATIONAL";
    host.innerHTML = `<div class="device-detail-icon ${type}">${typeSymbols[type]}</div><div class="device-name">${escapeHtml(element.data("label"))}</div><div class="device-type">${typeNames[type].toUpperCase()} / NODE</div><div class="detail-status ${down ? "down" : unreachable ? "impacted" : ""}"><i></i>${statusText}</div><div class="detail-list"><div class="detail-row"><span>Node ID</span><b>${escapeHtml(element.id())}</b></div><div class="detail-row"><span>Connections</span><b>${element.degree()}</b></div><div class="detail-row"><span>Neighbors</span><b>${neighbors.length ? neighbors.map(escapeHtml).join(", ") : "None"}</b></div><div class="detail-row"><span>Reachability</span><b>${lastAnalysis ? (down ? "Offline" : unreachable ? "Unreachable" : "Reachable") : "Not analyzed"}</b></div></div><div class="inspector-actions"><button class="small-action ${down ? "" : "danger"}" id="toggleSelected">${down ? "Restore device" : "Simulate failure"}</button><button class="small-action danger" id="deleteSelected">Delete</button></div>`;
    $("toggleSelected").onclick = () => { element.data("status", down ? "up" : "down"); invalidateAnalysis(); renderInspector(element); notify(`${element.data("label")} marked ${down ? "UP" : "DOWN"}`); };
    $("deleteSelected").onclick = () => { element.remove(); selectedId = null; invalidateAnalysis(); renderInspector(null); notify("Device deleted"); };
  }
  function updateStats() {
    $("deviceCount").textContent = cy.nodes().length;
    $("linkCount").textContent = cy.edges().length;
    $("healthyCount").textContent = cy.nodes().filter(n => n.data("status") !== "down" && n.data("unreachable") !== "true").length;
    $("impactCount").textContent = cy.nodes().filter(n => n.data("unreachable") === "true").length;
    $("canvasHint").classList.toggle("hidden", cy.nodes().length > 0);
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function loadDemo() {
    cy.elements().remove();
    counters = { router: 0, switch: 0, server: 0 };
    const nodes = [
      { type: "server", label: "Server A", x: 95, y: 145 },
      { type: "router", label: "Router 1", x: 230, y: 145 },
      { type: "switch", label: "Switch 1", x: 365, y: 145 },
      { type: "router", label: "Router 2", x: 500, y: 90 },
      { type: "router", label: "Router 3", x: 500, y: 205 },
      { type: "server", label: "Server B", x: 645, y: 90 },
      { type: "server", label: "Server C", x: 645, y: 205 }
    ];
    const ids = {};
    nodes.forEach((n, i) => {
      const id = makeId(n.type); ids[n.label] = id;
      cy.add({ group: "nodes", data: { id, label: n.label, type: n.type, status: "up", unreachable: "false" }, position: { x: n.x, y: n.y } });
    });
    const links = [
      ["Server A", "Router 1"], ["Router 1", "Switch 1"], ["Switch 1", "Router 2"],
      ["Switch 1", "Router 3"], ["Router 2", "Server B"], ["Router 3", "Server C"],
      ["Router 2", "Router 3"]
    ];
    links.forEach(([a,b]) => cy.add({ group: "edges", data: { id: `link-${ids[a]}-${ids[b]}`, source: ids[a], target: ids[b], status: "up" } }));
    $("canvasHint").classList.add("hidden");
    cy.fit(cy.elements(), 45);
    selectedId = null; renderInspector(null); invalidateAnalysis(); simulateFailure();
    notify("Demo topology loaded — try failing Router 1 or a link");
  }
  $("loadDemoBtn").onclick = loadDemo;
  $("emptyDemoBtn").onclick = loadDemo;
  $("resetBtn").onclick = () => {
    cy.elements().remove(); counters = { router: 0, switch: 0, server: 0 };
    selectedId = null; linkMode = false; firstLinkNode = null;
    $("linkMode").classList.remove("active"); $("linkMode").innerHTML = "<span>⌁</span> Link mode: OFF";
    renderInspector(null); invalidateAnalysis(); notify("Workspace reset");
  };

  function serializeTopology() {
    return {
      version: 1,
      nodes: cy.nodes().map(n => ({ data: { ...n.data() }, position: n.position() })),
      edges: cy.edges().map(e => ({ data: { ...e.data() } })),
      counters
    };
  }
  function saveTopology(silent = false) {
    try {
      localStorage.setItem("netflow-topology-v1", JSON.stringify(serializeTopology()));
      if (!silent) notify("Topology saved in this browser");
    } catch (err) { notify("Could not save topology in browser storage"); }
  }
  $("saveBtn").onclick = () => saveTopology();
  cy.on("add remove data position", () => { updateStats(); });
  function restoreSaved() {
    try {
      const raw = localStorage.getItem("netflow-topology-v1");
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) return false;
      cy.elements().remove();
      counters = data.counters || { router: 0, switch: 0, server: 0 };
      data.nodes.forEach(n => cy.add({ group: "nodes", data: n.data, position: n.position }));
      data.edges.forEach(e => cy.add({ group: "edges", data: e.data }));
      $("canvasHint").classList.toggle("hidden", cy.nodes().length > 0);
      cy.fit(cy.elements(), 45); updateStats(); return true;
    } catch (_) { return false; }
  }
  $("exportBtn").onclick = () => {
    if (!lastAnalysis) simulateFailure();
    const content = [
      "NETFLOW — NETWORK CHANGE IMPACT REPORT",
      `Generated: ${new Date().toLocaleString()}`,
      `Devices: ${cy.nodes().length} | Links: ${cy.edges().length}`,
      `Failed devices: ${lastAnalysis.downNodes.join(", ") || "None"}`,
      `Failed links: ${lastAnalysis.downEdges.join(", ") || "None"}`,
      `Unreachable devices: ${lastAnalysis.unreachable.join(", ") || "None"}`,
      `Impacted servers: ${lastAnalysis.affectedServers.join(", ") || "None"}`,
      "",
      "Method: Breadth-First Search (BFS) over operational nodes and links.",
      "Note: This is a graph-based reachability simulation, not a packet-level network emulator."
    ].join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = "netflow-impact-report.txt"; a.click(); URL.revokeObjectURL(url);
    notify("Impact report exported");
  };

  if (!restoreSaved()) loadDemo();
  else { invalidateAnalysis(); simulateFailure(); }
  updateStats();
})();
