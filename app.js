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

  // NetFlow v1.1: adaptive micro-batching.
  // v1.0 remains frozen. v1.1 keeps one scheduled flush, coalesces bursts,
  // and uses a smaller wait for small topologies to avoid fixed-delay overhead.
  const actorId = `engineer-${Math.random().toString(36).slice(2, 8)}`;
  const seenOperations = new Set(), fieldVersions = new Map(), tombstones = new Set();
  let topologyRevision = 0, batchNumber = 0, pendingOperations = [], deferredOperations = new Map(), batchTimer = null, applyingRemote = false;
  let lastAnalysisRevision = -1;
  const MAX_BATCH_WAIT_MS = 1;
  const IMMEDIATE_FLUSH_THRESHOLD = 32;
  // Avoid browser timer clamping (often ~4 ms) on graphs where that delay
  // costs more than the BFS work being saved. Larger graphs retain a tiny
  // coalescing window; the queue is never allowed to grow without a cap.
  const batchWaitForTopology = () => cy.nodes().length <= 1000 ? 0 : MAX_BATCH_WAIT_MS;
  const channel = ("BroadcastChannel" in window) ? new BroadcastChannel("netflow-concurrent-v1") : null;
  const updateConcurrencyUI = (busy=false) => {
    $("revisionValue").textContent = topologyRevision;
    $("batchValue").textContent = batchNumber;
    $("queueValue").textContent = pendingOperations.length + deferredOperations.size;
    $("syncState").textContent = channel ? (busy ? "Merging engineer updates…" : "Multi-tab sync enabled · ready") : (busy ? "Merging local updates…" : "Local batching enabled");
    $("syncIndicator").classList.toggle("busy",busy);
  };
  const versionOf = op => `${String(op.clock).padStart(14,"0")}:${op.actor}:${op.id}`;
  function publishOperation(type,payload) {
    if (applyingRemote) return;
    const op={id:`${actorId}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,actor:actorId,clock:Date.now(),baseRevision:topologyRevision,type,payload};
    seenOperations.add(op.id); pendingOperations.push(op);
    if(channel) channel.postMessage(op);
    scheduleBatch();
  }
  function receiveOperation(op) {
    if(!op || !op.id || op.actor===actorId || seenOperations.has(op.id)) return;
    seenOperations.add(op.id); pendingOperations.push(op); scheduleBatch();
  }
  if(channel) channel.onmessage=e=>receiveOperation(e.data);
  function scheduleBatch() {
    updateConcurrencyUI(true);
    // Never reset an existing timer: a continuous stream cannot starve a flush.
    if (batchTimer !== null) return;
    if (pendingOperations.length >= IMMEDIATE_FLUSH_THRESHOLD) {
      flushOperationBatch();
      return;
    }
    const waitMs = batchWaitForTopology();
    if (waitMs === 0) {
      // A microtask coalesces synchronous edits without incurring the
      // browser's minimum setTimeout delay. It also cannot be starved by
      // subsequent user events because it runs before the next task.
      batchTimer = { microtask: true };
      queueMicrotask(flushOperationBatch);
    } else {
      batchTimer = setTimeout(flushOperationBatch, waitMs);
    }
  }
  function applyOperation(op) {
    const p=op.payload||{}, v=versionOf(op);
    if(op.type==="topology.replace") {
      // A fixture/import snapshot establishes the shared starting graph for all tabs.
      cy.elements().remove();
      fieldVersions.clear();
      tombstones.clear();
      deferredOperations.clear();
      (p.nodes || []).forEach(n => cy.add({ group:"nodes", data:n.data, position:n.position }));
      (p.edges || []).forEach(e => cy.add({ group:"edges", data:e.data }));
      counters = { router:0, switch:0, server:0, ...(p.counters || {}) };
      selectedId = null;
      renderInspector(null);
      return true;
    }
    if(op.type==="node.add") {
      if(tombstones.has(p.id)) return true;
      if(!cy.getElementById(p.id).length) {
        cy.add({group:"nodes",data:p.data,position:p.position});
        const m=p.id.match(/(\d+)$/); if(m && counters[p.data.type]!==undefined) counters[p.data.type]=Math.max(counters[p.data.type],+m[1]);
      }
      return true;
    }
    if(op.type==="link.add") {
      if(tombstones.has(p.id)) return true;
      // Do not lose a link if its endpoint-add messages arrive in a later batch.
      if(!cy.getElementById(p.data.source).length || !cy.getElementById(p.data.target).length) return false;
      if(!cy.getElementById(p.id).length) cy.add({group:"edges",data:p.data});
      return true;
    }
    if(op.type==="node.position") {
      // Position updates are emitted once when a local drag ends, not for every
      // pointer movement. Keep them pending if the node-add has not arrived yet.
      if(tombstones.has(p.entityId)) return true;
      const el=cy.getElementById(p.entityId);
      if(!el.length) return false;
      const key=`node.position:${p.entityId}`;
      if(v >= (fieldVersions.get(key)||"")) {
        if(p.position && Number.isFinite(p.position.x) && Number.isFinite(p.position.y)) {
          el.position({ x:p.position.x, y:p.position.y });
          fieldVersions.set(key,v);
        }
      }
      return true;
    }
    if(op.type==="node.status" || op.type==="link.status") {
      // A status update for an entity already deleted is obsolete, not a dependency.
      if(tombstones.has(p.entityId)) return true;
      const key=`${op.type}:${p.entityId}`;
      const el=cy.getElementById(p.entityId);
      // Keep the operation pending until its entity exists; otherwise a later add
      // would incorrectly leave the entity at its default status.
      if(!el.length) return false;
      if(v >= (fieldVersions.get(key)||"")) { el.data("status",p.status); fieldVersions.set(key,v); }
      return true;
    }
    if(op.type==="node.delete" || op.type==="link.delete") {
      tombstones.add(p.entityId); const el=cy.getElementById(p.entityId); if(el.length) el.remove();
      return true;
    }
    return true;
  }
  function flushOperationBatch() {
    batchTimer=null;
    if(!pendingOperations.length && !deferredOperations.size){updateConcurrencyUI(false);return;}
    const fresh=pendingOperations.splice(0).sort((a,b)=>a.clock-b.clock || a.actor.localeCompare(b.actor) || a.id.localeCompare(b.id));
    const work=[...deferredOperations.values(), ...fresh];
    deferredOperations.clear();
    applyingRemote=true;
    try {
      // Resolve dependencies in order: snapshot, nodes, links, then state changes.
      // Retry deferred work after additions so out-of-order messages can converge.
      const phases=[
        work.filter(op=>op.type==="topology.replace"),
        work.filter(op=>op.type==="node.add"),
        work.filter(op=>op.type==="link.add"),
        work.filter(op=>!["topology.replace","node.add","link.add"].includes(op.type))
      ];
      const unresolved=[];
      phases.forEach(phase=>phase.forEach(op=>{if(!applyOperation(op)) unresolved.push(op);}));
      // One additional dependency pass handles a link-add and its endpoint-add
      // delivered in different batches without waiting for another user edit.
      const retry=[];
      unresolved.forEach(op=>{if(!applyOperation(op)) retry.push(op);});
      retry.forEach(op=>deferredOperations.set(op.id,op));
    } finally {
      applyingRemote=false;
    }
    // Revisions count newly received unique operations once, not retries.
    topologyRevision+=fresh.length; batchNumber++;
    invalidateAnalysis();
    updateConcurrencyUI(false);
    simulateFailure({quiet:true});
    $("analysisTime").textContent=`Revision ${topologyRevision} · batch ${batchNumber}`;
    if(selectedId && cy.getElementById(selectedId).length) renderInspector(cy.getElementById(selectedId));
    if(pendingOperations.length) scheduleBatch();
  }


  const typeNames = { router: "Router", switch: "Switch", server: "Server" };
  const typeSymbols = { router: "R", switch: "S", server: "▣" };
  const makeId = (type) => {
    counters[type] += 1;
    return `${type}-${actorId}-${counters[type]}`;
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
    const nodeData = { id, label: `${typeNames[type]} ${counters[type]}`, type, status: "up", unreachable: "false" };
    cy.add({ group: "nodes", data: nodeData, position: pos });
    publishOperation("node.add", { id, data: nodeData, position: pos });
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
          const edgeData = { id: `link-${source}-${target}`, source, target, status: "up" };
          cy.add({ group: "edges", data: edgeData });
          publishOperation("link.add", { id: edgeData.id, data: edgeData });
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
    publishOperation("link.status", { entityId: edge.id(), status: edge.data("status") });
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

  function runBatchBenchmark(changeCount=40) {
    // Same synthetic change workload and graph snapshot in both cases.
    // Measures update application + reachability computation; excludes UI paint
    // and the deliberate batching wait, which is reported separately.
    const nodeIds = cy.nodes().map(n => n.id());
    const edgeIds = cy.edges().map(e => e.id());
    if (!nodeIds.length) return { sequential: 0, batched: 0, changeCount };
    const makeState = () => ({
      nodes: new Map(cy.nodes().map(n => [n.id(), n.data("status")])),
      edges: new Map(cy.edges().map(e => [e.id(), e.data("status")]))
    });
    const workload = Array.from({length: changeCount}, (_, i) => ({
      kind: i % 2 ? "edge" : "node",
      id: i % 2 ? edgeIds[i % Math.max(1, edgeIds.length)] : nodeIds[i % nodeIds.length],
      status: i % 3 ? "down" : "up"
    })).filter(op => op.kind !== "edge" || edgeIds.length);
    const analyze = state => {
      const adj = new Map([...state.nodes.keys()].map(id => [id, []]));
      cy.edges().forEach(e => {
        const a=e.data("source"), b=e.data("target");
        if (state.edges.get(e.id()) !== "down" && state.nodes.get(a) !== "down" && state.nodes.get(b) !== "down") {
          adj.get(a)?.push(b); adj.get(b)?.push(a);
        }
      });
      const seen=new Set(); let componentCount=0, largest=0;
      for(const start of adj.keys()) {
        if(state.nodes.get(start)==="down" || seen.has(start)) continue;
        componentCount++; const q=[start]; seen.add(start); let size=0;
        for(let i=0;i<q.length;i++) { size++; for(const next of (adj.get(q[i])||[])) if(!seen.has(next)){seen.add(next);q.push(next);} }
        largest=Math.max(largest,size);
      }
      return {componentCount,largest};
    };
    let seq=makeState();
    const t1=performance.now();
    workload.forEach(op=>{ (op.kind === "node" ? seq.nodes : seq.edges).set(op.id,op.status); analyze(seq); });
    const sequential=performance.now()-t1;
    let bat=makeState();
    const t2=performance.now();
    workload.forEach(op=>{ (op.kind === "node" ? bat.nodes : bat.edges).set(op.id,op.status); });
    analyze(bat);
    const batched=performance.now()-t2;
    return {sequential,batched,changeCount:workload.length};
  }

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
  // Find EVERY connected component in the operational graph. Unlike the old
  // multi-source-from-servers approach, this does not seed BFS from every
  // server (which incorrectly made isolated servers appear reachable).
  // Complexity: O(V + E), because each operational node and link is visited once.
  function findConnectedComponents(adjacency) {
    const visited = new Set();
    const components = [];
    const ids = Object.keys(adjacency).sort(); // stable traversal / tie-breaking
    for (const start of ids) {
      if (visited.has(start)) continue;
      const queue = [start], component = [];
      visited.add(start);
      for (let i = 0; i < queue.length; i++) {
        const current = queue[i];
        component.push(current);
        for (const next of adjacency[current] || []) {
          if (!visited.has(next)) { visited.add(next); queue.push(next); }
        }
      }
      component.sort();
      components.push(component);
    }
    // No gateway is defined in this product yet. Use the largest operational
    // component as the primary network segment; ties are resolved by its first ID.
    components.sort((a,b) => b.length-a.length || a[0].localeCompare(b[0]));
    return components;
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
  function simulateFailure(options = {}) {
    if (cy.nodes().length === 0) { if(!options.quiet) notify("Add or load devices before analyzing"); return; }
    const adjacency = buildAdjacencyList();
    const components = findConnectedComponents(adjacency);
    const primaryComponent = components[0] || [];
    const reachable = new Set(primaryComponent);
    const unreachable = [];
    cy.nodes().forEach(n => {
      const isDown = n.data("status") === "down";
      const isUnreachable = !isDown && !reachable.has(n.id());
      n.data("unreachable", isUnreachable ? "true" : "false");
      if (isUnreachable) unreachable.push(n.id());
    });
    const isolated = components.filter(component => component.length === 1).map(component => component[0]);
    const disconnectedComponents = components.slice(1);
    const downNodes = cy.nodes().filter(n => n.data("status") === "down").map(n => n.id());
    const downEdges = cy.edges().filter(e => e.data("status") === "down").map(e => e.id());
    const failedServers = cy.nodes('[type = "server"]').filter(s => s.data("status") === "down").map(s => s.id());
    const affectedServers = cy.nodes('[type = "server"]').filter(s => s.data("status") !== "down" && !reachable.has(s.id())).map(s => s.id());
    const allDown = downNodes.length + downEdges.length > 0;
    lastAnalysisRevision = topologyRevision;
    lastAnalysis = { revision: topologyRevision, adjacency, components, primaryComponent, disconnectedComponents, isolated, reachable: [...reachable], unreachable, downNodes, downEdges, failedServers, affectedServers, allDown, timestamp: new Date().toLocaleString() };
    renderReport(lastAnalysis);
    $("analysisTime").textContent = `Revision ${lastAnalysisRevision} · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    const status = $("networkStatus");
    if (unreachable.length || failedServers.length) {
      status.className = "health-indicator bad";
      status.innerHTML = "<span></span> IMPACT DETECTED";
    } else if (!allDown) {
      status.className = "health-indicator ok";
      status.innerHTML = "<span></span> NETWORK HEALTHY";
    } else {
      status.className = "health-indicator ok";
      status.innerHTML = "<span></span> RESILIENT";
    }
    updateStats();
    if (selectedId && cy.getElementById(selectedId).length) renderInspector(cy.getElementById(selectedId));
    if(!options.quiet) notify("Impact analysis completed using BFS");
  }
  $("simulateBtn").onclick = simulateFailure;
  $("concurrentDemoBtn").onclick = () => {
    if(cy.nodes().length<4) loadDemo();
    const routers=cy.nodes('[type = "router"]'), edges=cy.edges();
    if(routers.length && edges.length) {
      const changes=[
        ["node.status",{entityId:routers[0].id(),status:"down"}],
        ["link.status",{entityId:edges[0].id(),status:"down"}],
        ["node.status",{entityId:routers[routers.length-1].id(),status:"down"}],
        ["link.status",{entityId:edges[edges.length-1].id(),status:"down"}]
      ];
      changes.forEach(([type,payload])=>publishOperation(type,payload));
      // Apply the local demo events to the visible graph immediately; batch commit reconciles once.
      changes.forEach(([type,payload])=>applyOperation({id:`demo-${Math.random()}`,actor:"demo-engineer",clock:Date.now()+Math.random(),type,payload}));
      invalidateAnalysis();
      const benchmark = runBatchBenchmark(40);
      $("syncState").textContent = `CPU benchmark (${benchmark.changeCount} updates): sequential ${benchmark.sequential.toFixed(2)}ms / batched ${benchmark.batched.toFixed(2)}ms · adaptive batching`;
      notify("Four interleaved engineer changes queued. One combined BFS report will follow.");
    }
  };

  function renderReport(result) {
    const downCount = result.downNodes.length + result.downEdges.length;
    const statusLine = result.unreachable.length
      ? ["Network segmentation detected", "The operational topology contains devices outside the primary connected component. Review the disconnected segments and failed components below."]
      : result.failedServers.length
        ? ["Server failure detected", "One or more servers are failed. The remaining operational devices are grouped by connected component below."]
        : result.allDown
          ? ["Redundancy preserved", "Failures are present, but all remaining operational devices belong to one connected component."]
          : ["Network healthy", "No devices or links are marked down, and all operational devices belong to one connected component."];
    const unreachableLabels = result.unreachable.map(id => cy.getElementById(id).data("label"));
    const failedLabels = result.downNodes.map(id => cy.getElementById(id).data("label"));
    const failedLinkLabels = result.downEdges.map(id => {
      const e = cy.getElementById(id); return `${e.source().data("label")} ↔ ${e.target().data("label")}`;
    });
    let recommendation = "No immediate recovery action required. Save this topology as a baseline for future change tests.";
    if (result.disconnectedComponents.length) {
      recommendation = "Inspect each disconnected component. Restore failed devices or links, or add a redundant connection between the primary component and an isolated segment. If separate components are intentional (for example, separate network zones), define them as separate network domains instead of treating them as impact.";
    } else if (result.allDown) {
      recommendation = "Failures are present, but the remaining operational topology is still one connected component. Confirm the alternate paths are intended and document them.";
    }
    const chips = (items, cls) => items.length ? items.map(x => `<span class="chip ${cls}">${escapeHtml(x)}</span>`).join("") : '<p>None</p>';
    $("reportContent").innerHTML = `
      <div class="report-summary">
        <div class="summary-tile"><span>Operational devices</span><b class="good">${cy.nodes().filter(n=>n.data("status")!=="down").length}</b></div>
        <div class="summary-tile"><span>Disconnected devices</span><b class="${result.unreachable.length ? "warn" : "good"}">${result.unreachable.length}</b></div>
        <div class="summary-tile"><span>Operational components</span><b class="${result.components.length > 1 ? "warn" : "good"}">${result.components.length}</b></div>
        <div class="summary-tile"><span>Failures detected</span><b class="${downCount ? "warn" : "good"}">${downCount}</b></div>
      </div>
      <div class="report-message ${result.unreachable.length || result.failedServers.length ? "critical" : ""}"><b>${statusLine[0]}</b><p>${statusLine[1]}</p></div>
      <div class="report-columns">
        <div class="report-box"><h3>FAILED DEVICES</h3><div class="chip-list">${chips(failedLabels, "bad")}</div><div style="height:10px"></div><h3>FAILED LINKS</h3><div class="chip-list">${chips(failedLinkLabels, "bad")}</div></div>
        <div class="report-box"><h3>DISCONNECTED DEVICES</h3><div class="chip-list">${chips(unreachableLabels, "warn")}</div><div style="height:10px"></div><h3>IMPACTED SERVERS</h3><div class="chip-list">${chips(result.affectedServers.map(id=>cy.getElementById(id).data("label")), "warn")}</div><div style="height:10px"></div><h3>ISOLATED DEVICES</h3><div class="chip-list">${chips(result.isolated.map(id=>cy.getElementById(id).data("label")), "warn")}</div></div>
      </div>
      <div class="report-box" style="margin-top:12px"><h3>CONNECTED COMPONENTS</h3><p style="margin:6px 0 10px;color:var(--muted);font-size:12px">Primary component: ${result.primaryComponent.length} devices. Other components are disconnected from it.</p><div class="chip-list">${result.components.map((component,index)=>`<span class="chip ${index===0 ? "good" : "warn"}">Segment ${index+1}: ${component.map(id=>escapeHtml(cy.getElementById(id).data("label"))).join(" · ")}</span>`).join("") || "<p>No operational devices</p>"}</div></div>
      <div class="recommendation"><b>↗ Recovery recommendation</b><p>${recommendation}</p></div><div class="report-provenance">Report computed from committed topology revision <b>${result.revision}</b>.</div>`;
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
      $("toggleSelected").onclick = () => { element.data("status", down ? "up" : "down"); publishOperation("link.status", { entityId: element.id(), status: element.data("status") }); invalidateAnalysis(); renderInspector(element); };
      $("deleteSelected").onclick = () => { publishOperation("link.delete", { entityId: element.id() }); element.remove(); selectedId = null; invalidateAnalysis(); renderInspector(null); notify("Link deleted"); };
      return;
    }
    const type = element.data("type"), down = element.data("status") === "down", unreachable = element.data("unreachable") === "true";
    const neighbors = element.neighborhood("node").map(n => n.data("label"));
    const statusText = down ? "FAILED" : unreachable ? "UNREACHABLE" : "OPERATIONAL";
    host.innerHTML = `<div class="device-detail-icon ${type}">${typeSymbols[type]}</div><div class="device-name">${escapeHtml(element.data("label"))}</div><div class="device-type">${typeNames[type].toUpperCase()} / NODE</div><div class="detail-status ${down ? "down" : unreachable ? "impacted" : ""}"><i></i>${statusText}</div><div class="detail-list"><div class="detail-row"><span>Node ID</span><b>${escapeHtml(element.id())}</b></div><div class="detail-row"><span>Connections</span><b>${element.degree()}</b></div><div class="detail-row"><span>Neighbors</span><b>${neighbors.length ? neighbors.map(escapeHtml).join(", ") : "None"}</b></div><div class="detail-row"><span>Reachability</span><b>${lastAnalysis ? (down ? "Offline" : unreachable ? "Unreachable" : "Reachable") : "Not analyzed"}</b></div></div><div class="inspector-actions"><button class="small-action ${down ? "" : "danger"}" id="toggleSelected">${down ? "Restore device" : "Simulate failure"}</button><button class="small-action danger" id="deleteSelected">Delete</button></div>`;
    $("toggleSelected").onclick = () => { element.data("status", down ? "up" : "down"); publishOperation("node.status", { entityId: element.id(), status: element.data("status") }); invalidateAnalysis(); renderInspector(element); notify(`${element.data("label")} marked ${down ? "UP" : "DOWN"}`); };
    $("deleteSelected").onclick = () => { publishOperation("node.delete", { entityId: element.id() }); element.remove(); selectedId = null; invalidateAnalysis(); renderInspector(null); notify("Device deleted"); };
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
    // Reset pending local work before replacing the graph with a known shared fixture.
    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = null;
    pendingOperations = [];

    // Stable IDs are essential: Engineer A and Engineer B must refer to the
    // same logical devices when they independently edit the same demo topology.
    cy.elements().remove();
    fieldVersions.clear();
    tombstones.clear();
    counters = { router:3, switch:1, server:3 };
    const nodes = [
      { id:"server-a", type:"server", label:"Server A", x:95, y:145 },
      { id:"router-1", type:"router", label:"Router 1", x:230, y:145 },
      { id:"switch-1", type:"switch", label:"Switch 1", x:365, y:145 },
      { id:"router-2", type:"router", label:"Router 2", x:500, y:90 },
      { id:"router-3", type:"router", label:"Router 3", x:500, y:205 },
      { id:"server-b", type:"server", label:"Server B", x:645, y:90 },
      { id:"server-c", type:"server", label:"Server C", x:645, y:205 }
    ];
    const ids = {};
    nodes.forEach(n => {
      ids[n.label] = n.id;
      cy.add({ group:"nodes", data:{ id:n.id, label:n.label, type:n.type, status:"up", unreachable:"false" }, position:{ x:n.x, y:n.y } });
    });
    const links = [
      ["Server A", "Router 1"], ["Router 1", "Switch 1"], ["Switch 1", "Router 2"],
      ["Switch 1", "Router 3"], ["Router 2", "Server B"], ["Router 3", "Server C"],
      ["Router 2", "Router 3"]
    ];
    links.forEach(([a,b]) => cy.add({ group:"edges", data:{ id:`link-${ids[a]}-${ids[b]}`, source:ids[a], target:ids[b], status:"up" } }));
    $("canvasHint").classList.add("hidden");
    cy.fit(cy.elements(), 45);
    selectedId = null;
    renderInspector(null);
    invalidateAnalysis();
    simulateFailure({quiet:true});

    // Broadcast a complete baseline so a tab that loads/reloads later can
    // bring its peers onto the same graph. Receiving tabs do not rebroadcast it.
    publishOperation("topology.replace", serializeTopology());
    notify("Shared demo topology loaded — edits in other tabs can now target the same devices");
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
  // Broadcast a single final coordinate after a user finishes dragging a node.
  // Remote position application does not emit `free`, preventing echo loops.
  cy.on("free", "node", event => {
    if (applyingRemote) return;
    const node = event.target;
    if (!node || node.empty()) return;
    const position = node.position();
    publishOperation("node.position", {
      entityId: node.id(),
      position: { x: position.x, y: position.y }
    });
  });
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
      `Topology revision analyzed: ${lastAnalysis.revision}`,
      `Devices: ${cy.nodes().length} | Links: ${cy.edges().length}`,
      `Failed devices: ${lastAnalysis.downNodes.join(", ") || "None"}`,
      `Failed links: ${lastAnalysis.downEdges.join(", ") || "None"}`,
      `Unreachable devices: ${lastAnalysis.unreachable.join(", ") || "None"}`,
      `Impacted servers: ${lastAnalysis.affectedServers.join(", ") || "None"}`,
      "",
      `Operational connected components: ${lastAnalysis.components.length}`,
      `Primary component: ${lastAnalysis.primaryComponent.map(id => cy.getElementById(id).data("label")).join(", ") || "None"}`,
      `Isolated devices: ${lastAnalysis.isolated.map(id => cy.getElementById(id).data("label")).join(", ") || "None"}`,
      "Method: connected-component discovery using BFS over operational nodes and links (O(V + E)).",
      "Reachability rule: the largest operational component is the primary segment; other operational components are reported as disconnected. Equal-size ties use a stable ID order.",
      "Consistency: report is tied to the committed topology revision shown above.",
      "Note: This is a graph-based reachability simulation, not a packet-level network emulator."
    ].join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = "netflow-impact-report.txt"; a.click(); URL.revokeObjectURL(url);
    notify("Impact report exported");
  };

  if (!restoreSaved()) loadDemo();
  else { invalidateAnalysis(); simulateFailure({quiet:true}); }
  updateStats();
  updateConcurrencyUI(false);
  window.addEventListener("beforeunload",()=>{if(channel)channel.close();});
})();
