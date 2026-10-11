# NetFlow — Network Change Impact Simulator

**Tagline:** Understand your network before it fails.

**Team:** The Net Engineers

## Overview

NetFlow is a browser-based network topology and change impact simulator. It allows users to build network topologies, simulate device and link failures, and analyse the reachability impact of network changes.

The Phase 3 implementation extends the original project with concurrent topology update handling, conflict resolution and adaptive batching.

## Problem

In real network environments, multiple engineers may modify network topology simultaneously. Interleaved updates can produce stale or inconsistent impact reports. Recalculating the network after every individual update can also introduce unnecessary processing overhead.

## Solution

NetFlow introduces a concurrent change engine designed to synchronise topology changes across browser tabs and batch updates before impact analysis.

## Features

- Interactive network topology builder.
- Router, switch and server components.
- Network link creation and deletion.
- Device and link failure simulation.
- BFS-based reachability and impact analysis.
- Concurrent topology updates across browser tabs.
- Conflict handling for concurrent operations.
- Adaptive batching of topology updates.
- Save and export functionality.
- Separate synthetic performance benchmark.

## Phase Evolution

### Phase 1 — Initial implementation

Built the original browser-based topology simulator with network components and failure impact analysis.

### Phase 3 — Concurrent change handling

Extended the application with concurrent update synchronisation, conflict handling and adaptive batching. Tested concurrent operations across two browser tabs.

**Note:** Phase 2 was not completed. The Phase 3 implementation builds on the original Phase 1 project.

## Benchmark

The synthetic benchmark compares sequential and batched graph updates at three graph sizes:

| Nodes | Links |
|---:|---:|
| 100 | 113 |
| 500 | 570 |
| 1,000 | 1,142 |

Three benchmark runs were performed using 30 trials and 40 updates per trial.

All tested runs reported matching final states. The measured batched medians were lower than sequential medians in the synthetic benchmark.

**Limitations:** The benchmark excludes BroadcastChannel transport, actual Cytoscape rendering, browser painting and network latency. Its results should not be interpreted as end-to-end performance measurements.

## Technology Stack

- HTML5
- CSS3
- JavaScript
- Cytoscape.js
- BroadcastChannel API
- Breadth-First Search (BFS)

## Run Locally

1. Clone the repository.
2. Open a terminal in the project folder.
3. Run:

   `python3 -m http.server 8000`

4. Open `http://localhost:8000`.

5. Open `http://localhost:8000/benchmark.html` to run the synthetic benchmark.

## Repository

https://github.com/ajaysharma111/NetFlow

## Team

**The Net Engineers**