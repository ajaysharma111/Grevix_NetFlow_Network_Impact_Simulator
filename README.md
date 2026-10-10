# NetFlow — Network Change Impact Simulator

**Tagline:** Understand your network before it fails.  
**Team:** The Net Engineer

NetFlow is a browser-based prototype for exploring network topology and estimating the impact of device or link failures. It uses a graph model and Breadth-First Search (BFS) to calculate which devices remain reachable from operational servers.

## Features

- Add routers, switches, and servers to an interactive topology.
- Connect devices with Link Mode (select two nodes).
- Simulate device failures by clicking a node or using the inspector.
- Simulate link failures by clicking a connection or using the inspector.
- Run BFS-based reachability analysis and highlight unreachable devices.
- Read a plain-language impact summary and recovery recommendation.
- Load a sample network, save the topology in browser local storage, and export a text report.
- Inspect node type, status, neighbors, and connection count.

## Run locally

1. Download and unzip the project.
2. Open `index.html` in Chrome, Edge, or another modern browser.
3. Internet access is needed to load Cytoscape.js and the optional Google Fonts CDN.
4. Click **Load demo network** if the sample topology is not already visible.
5. Click **Analyze impact** to run the simulation.
6. Click a router or link to mark it down, then analyze again.
7. Click **Save topology** to save your current topology in this browser.

No Node.js, npm, database, or backend is required for this prototype.

## How the algorithm works

1. Build an adjacency list from links whose endpoints and link status are all operational.
2. Start a BFS traversal from each operational server.
3. Combine the nodes visited by those traversals into a reachable set.
4. Any operational node outside that set is marked unreachable.
5. Generate a report containing failed devices, failed links, unreachable nodes, and affected servers.

**Complexity:** BFS is `O(V + E)` per traversal. Since this prototype traverses from each operational server, the overall analysis is `O(S × (V + E))`, where `S` is the number of operational servers, `V` the number of devices, and `E` the number of links.

## Important limitation

NetFlow is a **graph-based reachability simulator**, not a packet-level emulator. It does not implement real IP addressing, routing protocols, ACLs, latency, bandwidth, or actual device configuration. The recovery text is a general recommendation; it does not claim to configure a real network.

## Team

- Ajay Sharma


## Suggested demo flow

1. Show the default healthy topology and run analysis.
2. Select Router 1 and simulate failure.
3. Run analysis and point out the unreachable device(s).
4. Restore Router 1 and fail one link instead.
5. Explain that BFS computes reachability from the graph, rather than using a pre-written animation.
6. Save the topology and export the report.
